// WEB SHOOTER — wrist sensor A
// micro:bit v2 / MakeCode JavaScript

const RADIO_GROUP = 71
const RADIO_BAND = 7

const SAMPLE_MS = 20
const POSE_HOLD_MS = 100
const ARM_WINDOW_MS = 1200
const POSE_LOSS_GRACE_MS = 320
const POSE_RELEASE_MS = 180
const COOLDOWN_MS = 650

// Unit-vector dot products are scaled to 1000.
// 900 is approximately a 26-degree cone around the calibrated pose.
const POSE_COS_MIN = 900
const GENERIC_POSE_COS_MAX = 910
const GENERIC_POSE_COS_MIN = 250
const MIN_FIRE_SEPARATION_COS = 970

// Radio is intentionally one-way: A sends, B only receives.
// Six short numeric copies give the wearable link extra margin without ACKs.
const RETRY_INTERVAL_MS = 60

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

// 0: waiting, 1: holding the wrist pose, 2: armed for an impulse.
let gestureState = 0
let readyForPose = true
let poseStartedAt = 0
let lastPoseAt = 0
let armedUntil = 0
let releaseStartedAt = -1
let cooldownUntil = 0

let sensitivityLevel = 2
let motionThreshold = 420

let bootId = Math.randomRange(1, 255)
let shotSequence = Math.randomRange(0, 999)

let pendingPacket = 0
let retryCount = 0
let nextRetryAt = 0

let shotFlashUntil = 0

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

function resetGesture(requireRelease: boolean): void {
    gestureState = 0
    readyForPose = !requireRelease
    poseStartedAt = 0
    lastPoseAt = 0
    armedUntil = 0
    releaseStartedAt = -1
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

function orientationIsFiringPose(): boolean {
    if (!neutralReady) {
        return false
    }

    let magnitude = Math.sqrt(
        gravityX * gravityX +
        gravityY * gravityY +
        gravityZ * gravityZ
    )

    if (magnitude < 100) {
        return false
    }

    let ux = gravityX * 1000 / magnitude
    let uy = gravityY * 1000 / magnitude
    let uz = gravityZ * 1000 / magnitude

    if (firePoseReady) {
        return unitDot(ux, uy, uz, fireX, fireY, fireZ) >= POSE_COS_MIN
    }

    // Safe fallback until button B is used to learn the exact firing pose.
    let neutralDot = unitDot(
        ux, uy, uz,
        neutralX, neutralY, neutralZ
    )

    return neutralDot <= GENERIC_POSE_COS_MAX &&
        neutralDot >= GENERIC_POSE_COS_MIN
}

function issueWebShot(now: number): void {
    shotSequence = (shotSequence + 1) % 1000

    // bootId 1..255 and sequence 0..999 fit in one small integer packet.
    pendingPacket = bootId * 1000 + shotSequence

    radio.sendNumber(pendingPacket)

    // B never transmits an acknowledgement. It removes these copies before
    // forwarding exactly one WEB line to the computer.
    retryCount = 5
    nextRetryAt = now + RETRY_INTERVAL_MS

    cooldownUntil = now + COOLDOWN_MS
    shotFlashUntil = now + 180

    resetGesture(true)
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

    let inPose = orientationIsFiringPose()

    // After a shot, the wrist must leave the firing pose before re-arming.
    if (!readyForPose) {
        if (!inPose) {
            if (releaseStartedAt < 0) {
                releaseStartedAt = now
            }

            if (
                now >= cooldownUntil &&
                now - releaseStartedAt >= POSE_RELEASE_MS
            ) {
                readyForPose = true
                releaseStartedAt = -1
                gestureState = 0
            }
        } else {
            releaseStartedAt = -1
        }
        return
    }

    if (gestureState == 0) {
        if (inPose) {
            gestureState = 1
            poseStartedAt = now
        }
        return
    }

    if (gestureState == 1) {
        if (!inPose) {
            gestureState = 0
            return
        }

        if (now - poseStartedAt >= POSE_HOLD_MS) {
            gestureState = 2
            armedUntil = now + ARM_WINDOW_MS
            lastPoseAt = now

            // Discard the movement used to enter the pose.
            gravityX = ax
            gravityY = ay
            gravityZ = az
        }
        return
    }

    if (gestureState == 2) {
        if (inPose) {
            lastPoseAt = now
        }

        if (
            now > armedUntil ||
            now - lastPoseAt > POSE_LOSS_GRACE_MS
        ) {
            resetGesture(true)
            return
        }

        if (now >= cooldownUntil && motion >= motionThreshold) {
            issueWebShot(now)
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
radio.setTransmitPower(7)

// Button A: learn the neutral/resting wrist orientation.
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
        resetGesture(false)
        cooldownUntil = control.millis() + 250
        basic.showIcon(IconNames.Yes, 250)
    } else {
        basic.showIcon(IconNames.No, 250)
    }

    calibrating = false
    nextDisplayAt = 0
})

// Button B: learn the bent-wrist firing pose.
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
    resetGesture(true)
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
    resetGesture(true)
    cooldownUntil = control.millis() + 300

    basic.showNumber(sensitivityLevel, 150)
    calibrating = false
    nextDisplayAt = 0
})

input.setAccelerometerRange(AcceleratorRange.FourG)
applySensitivity()

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
resetGesture(false)
calibrating = false

nextSampleAt = control.millis()
nextDisplayAt = control.millis()

basic.forever(function () {
    let now = control.millis()

    if (retryCount > 0 && now >= nextRetryAt) {
        radio.sendNumber(pendingPacket)
        retryCount -= 1
        nextRetryAt = now + RETRY_INTERVAL_MS
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
