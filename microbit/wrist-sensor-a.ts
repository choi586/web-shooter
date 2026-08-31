// WEB SHOOTER — wrist sensor A8
// micro:bit v2 / MakeCode JavaScript

const RADIO_GROUP = 147
const RADIO_BAND = 50
const WEB_PACKET = 73147

const SAMPLE_MS = 20
const POSE_HOLD_MS = 160
const POSE_STILL_MOTION_MAX = 180
const EXTENSION_WINDOW_MS = 900
const COOLDOWN_MS = 650
const RADIO_SETTLE_DELAY_MS = 220

// Unit-vector dot products are scaled to 1000.
// 900 is approximately a 26-degree cone around the calibrated pose.
const POSE_COS_MIN = 900
const MIN_FIRE_SEPARATION_COS = 900

// Radio is intentionally one-way. Gesture detection queues one transmission
// after the wrist has settled instead of transmitting at peak acceleration.

let neutralX = 0
let neutralY = 0
let neutralZ = 1000
let neutralReady = false

let fireX = 0
let fireY = 0
let fireZ = 1000
let firePoseReady = false

let captureX = 0
let captureY = 0
let captureZ = 1000

let gravityX = 0
let gravityY = 0
let gravityZ = 1024

let calibrating = true

// 0: waiting for bent N pose, 1: holding bent N pose, 2: armed to extend.
let gestureState = 0
let poseStartedAt = 0
let extensionStartedAt = -1
let departureMotion = 0
let cooldownUntil = 0

let sensitivityLevel = 2
let motionThreshold = 420

let shotFlashUntil = 0
let radioShotPending = false
let radioShotAt = 0

let nextSampleAt = 0
let nextDisplayAt = 0

function captureOrientation(sampleCount: number): boolean {
    let sumX = 0
    let sumY = 0
    let sumZ = 0

    for (let i = 0; i < sampleCount; i++) {
        sumX += input.acceleration(Dimension.X)
        sumY += input.acceleration(Dimension.Y)
        sumZ += input.acceleration(Dimension.Z)
        basic.pause(20)
    }

    let averageX = sumX / sampleCount
    let averageY = sumY / sampleCount
    let averageZ = sumZ / sampleCount
    let magnitude = Math.sqrt(
        averageX * averageX +
        averageY * averageY +
        averageZ * averageZ
    )

    if (magnitude < 400) {
        return false
    }

    captureX = averageX * 1000 / magnitude
    captureY = averageY * 1000 / magnitude
    captureZ = averageZ * 1000 / magnitude
    return true
}

function unitDot(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number
): number {
    return (ax * bx + ay * by + az * bz) / 1000
}

function resetMotionFilter(): void {
    gravityX = input.acceleration(Dimension.X)
    gravityY = input.acceleration(Dimension.Y)
    gravityZ = input.acceleration(Dimension.Z)
}

function resetGesture(): void {
    gestureState = 0
    poseStartedAt = 0
    extensionStartedAt = -1
    departureMotion = 0
}

function applySensitivity(): void {
    if (sensitivityLevel == 1) {
        motionThreshold = 300
    } else if (sensitivityLevel == 2) {
        motionThreshold = 420
    } else {
        motionThreshold = 560
    }
}

function orientationDot(
    poseX: number,
    poseY: number,
    poseZ: number
): number {
    let magnitude = Math.sqrt(
        gravityX * gravityX +
        gravityY * gravityY +
        gravityZ * gravityZ
    )

    if (magnitude < 100) {
        return -1000
    }

    let ux = gravityX * 1000 / magnitude
    let uy = gravityY * 1000 / magnitude
    let uz = gravityZ * 1000 / magnitude

    return unitDot(ux, uy, uz, poseX, poseY, poseZ)
}

function orientationIsStartPose(): boolean {
    return neutralReady &&
        orientationDot(neutralX, neutralY, neutralZ) >= POSE_COS_MIN
}

function orientationIsFiringPose(): boolean {
    return firePoseReady &&
        orientationDot(fireX, fireY, fireZ) >= POSE_COS_MIN
}

function issueWebShot(now: number): void {
    radioShotPending = true
    radioShotAt = now + RADIO_SETTLE_DELAY_MS

    cooldownUntil = now + COOLDOWN_MS

    resetGesture()
}

function processGesture(now: number): void {
    let ax = input.acceleration(Dimension.X)
    let ay = input.acceleration(Dimension.Y)
    let az = input.acceleration(Dimension.Z)

    // Low-pass gravity estimate. Raw acceleration minus this estimate
    // approximates the distinct forward "snap" of the arm.
    gravityX = (gravityX * 7 + ax) / 8
    gravityY = (gravityY * 7 + ay) / 8
    gravityZ = (gravityZ * 7 + az) / 8

    let motionX = ax - gravityX
    let motionY = ay - gravityY
    let motionZ = az - gravityZ
    let motion = Math.sqrt(
        motionX * motionX +
        motionY * motionY +
        motionZ * motionZ
    )

    let inStartPose = orientationIsStartPose()
    let inFiringPose = orientationIsFiringPose()

    if (gestureState == 0) {
        if (firePoseReady && inStartPose) {
            gestureState = 1
            poseStartedAt = now
        }
        return
    }

    if (gestureState == 1) {
        if (!inStartPose) {
            resetGesture()
            return
        }

        // Folding into N is setup, never a shot. Arm only after the bent arm
        // is held still long enough to show the target.
        if (motion > POSE_STILL_MOTION_MAX) {
            poseStartedAt = now
            return
        }

        if (now - poseStartedAt >= POSE_HOLD_MS) {
            gestureState = 2
            extensionStartedAt = -1
            departureMotion = 0

            // Discard the movement used to fold into the start pose.
            gravityX = ax
            gravityY = ay
            gravityZ = az
        }
        return
    }

    if (gestureState == 2) {
        // The target is shown while the arm remains in the bent N pose.
        if (extensionStartedAt < 0 && inStartPose) {
            return
        }

        if (extensionStartedAt < 0) {
            extensionStartedAt = now
            departureMotion = motion
        } else {
            departureMotion = Math.max(departureMotion, motion)
        }

        // Fire only after travelling from the bent N pose into the extended
        // F pose learned with button B.
        if (
            inFiringPose &&
            now >= cooldownUntil &&
            departureMotion >= motionThreshold
        ) {
            issueWebShot(now)
            return
        }

        if (now - extensionStartedAt > EXTENSION_WINDOW_MS) {
            resetGesture()
        }
    }
}

function drawBurst(): void {
    led.plot(2, 0)
    led.plot(2, 1)
    led.plot(2, 2)
    led.plot(2, 3)
    led.plot(2, 4)
    led.plot(0, 2)
    led.plot(1, 2)
    led.plot(3, 2)
    led.plot(4, 2)
    led.plot(0, 0)
    led.plot(4, 0)
    led.plot(0, 4)
    led.plot(4, 4)
}

function drawTarget(): void {
    led.plot(2, 2)
    led.plot(2, 0)
    led.plot(0, 2)
    led.plot(4, 2)
    led.plot(2, 4)
}

function renderDisplay(now: number): void {
    basic.clearScreen()

    if (now < shotFlashUntil) {
        drawBurst()
        return
    }

    if (gestureState == 2) {
        drawTarget()
        return
    }

    if (gestureState == 1) {
        led.plot(2, 1)
        led.plot(2, 2)
        led.plot(2, 3)
        return
    }

    if (!firePoseReady) {
        // Small diamond: linked and using generic pose detection.
        led.plot(2, 1)
        led.plot(1, 2)
        led.plot(3, 2)
        led.plot(2, 3)
        return
    }

    // Linked, calibrated, and ready.
    led.plot(2, 2)
}

radio.setGroup(RADIO_GROUP)
radio.setFrequencyBand(RADIO_BAND)
// One full-power packet tolerates body shielding without a receiver event burst.
radio.setTransmitPower(7)

// Button A: learn the bent-arm neutral/start orientation.
input.onButtonPressed(Button.A, function () {
    if (calibrating) {
        return
    }

    calibrating = true
    basic.showString("N", 80)

    if (captureOrientation(30)) {
        neutralX = captureX
        neutralY = captureY
        neutralZ = captureZ
        neutralReady = true
        firePoseReady = false

        resetMotionFilter()
        resetGesture()
        cooldownUntil = control.millis() + 250
        basic.showIcon(IconNames.Yes, 250)
    } else {
        basic.showIcon(IconNames.No, 250)
    }

    calibrating = false
    nextDisplayAt = 0
})

// Button B: learn the fully extended firing/end orientation.
input.onButtonPressed(Button.B, function () {
    if (calibrating) {
        return
    }

    calibrating = true
    basic.showString("F", 80)

    let accepted = false

    if (captureOrientation(30) && neutralReady) {
        let separation = unitDot(
            captureX, captureY, captureZ,
            neutralX, neutralY, neutralZ
        )

        if (separation <= MIN_FIRE_SEPARATION_COS) {
            fireX = captureX
            fireY = captureY
            fireZ = captureZ
            firePoseReady = true
            accepted = true
        }
    }

    resetMotionFilter()
    resetGesture()
    cooldownUntil = control.millis() + 300

    if (accepted) {
        basic.showIcon(IconNames.Yes, 250)
    } else {
        basic.showIcon(IconNames.No, 250)
    }

    calibrating = false
    nextDisplayAt = 0
})

// A+B: end-to-end manual radio test shot.
input.onButtonPressed(Button.AB, function () {
    if (!calibrating) {
        issueWebShot(control.millis())
    }
})

// micro:bit v2 logo: sensitivity 1 (high), 2 (normal), 3 (low).
input.onLogoEvent(TouchButtonEvent.Pressed, function () {
    if (calibrating) {
        return
    }

    calibrating = true
    sensitivityLevel = sensitivityLevel % 3 + 1
    applySensitivity()

    resetMotionFilter()
    resetGesture()
    cooldownUntil = control.millis() + 300

    basic.showNumber(sensitivityLevel, 150)
    calibrating = false
    nextDisplayAt = 0
})

input.setAccelerometerRange(AcceleratorRange.FourG)
applySensitivity()

// Firmware marker. If A8 is not shown, the old build is still installed.
basic.showString("A8", 80)

// Power-on neutral calibration. Keep the worn wrist still while N is shown.
basic.showString("N", 80)

let autoCalibrated = captureOrientation(30)
if (!autoCalibrated) {
    autoCalibrated = captureOrientation(1)
}

if (autoCalibrated) {
    neutralX = captureX
    neutralY = captureY
    neutralZ = captureZ
    neutralReady = true
    basic.showIcon(IconNames.Yes, 250)
} else {
    basic.showIcon(IconNames.No, 250)
}

resetMotionFilter()
resetGesture()
calibrating = false

nextSampleAt = control.millis()
nextDisplayAt = control.millis()

basic.forever(function () {
    let now = control.millis()

    if (radioShotPending && now >= radioShotAt) {
        radioShotPending = false
        radio.sendNumber(WEB_PACKET)
        // The burst now means the Radio send call actually ran.
        shotFlashUntil = now + 180
    }

    if (!calibrating && now >= nextSampleAt) {
        nextSampleAt = now + SAMPLE_MS
        processGesture(now)
    }

    if (!calibrating && now >= nextDisplayAt) {
        nextDisplayAt = now + 80
        renderDisplay(now)
    }

    basic.pause(5)
})
