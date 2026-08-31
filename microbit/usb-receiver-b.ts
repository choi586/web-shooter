// WEB SHOOTER — USB receiver B6
// micro:bit v2 / MakeCode JavaScript
// Minimal Radio interrupt + short USB protocol stability build.

const RADIO_GROUP = 147
const RADIO_BAND = 50
const WEB_PACKET = 73147
const SERIAL_HEARTBEAT_MS = 1000

// 0: none, 1: Radio shot, 2: receiver-local test.
let pendingKind = 0
let pendingSequence = 0
let radioPulse = false
let pendingHeartbeat = false

let remoteSequence = Math.randomRange(0, 999)
let localSequence = Math.randomRange(0, 999)

let webFlashUntil = 0
let statusFlashUntil = 0
let nextHeartbeatAt = 0
let nextDisplayAt = 0

function queueShot(kind: number, sequence: number): void {
    pendingKind = kind
    pendingSequence = sequence
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

function drawCheck(): void {
    led.plot(0, 2)
    led.plot(1, 3)
    led.plot(2, 4)
    led.plot(3, 2)
    led.plot(4, 0)
}

function renderDisplay(now: number): void {
    basic.clearScreen()

    if (now < webFlashUntil) {
        drawBurst()
        return
    }

    if (now < statusFlashUntil) {
        drawCheck()
        return
    }

    // Center dot means ready. The corner blink proves the main loop is alive.
    led.plot(2, 2)
    if (Math.floor(now / 500) % 2 == 0) {
        led.plot(4, 4)
    }
}

serial.redirectToUSB()
serial.setBaudRate(BaudRate.BaudRate115200)
serial.setWriteLinePadding(0)

radio.setGroup(RADIO_GROUP)
radio.setFrequencyBand(RADIO_BAND)

radio.onReceivedNumber(function (packet: number) {
    // The Radio callback does only one comparison and one flag write.
    if (packet == WEB_PACKET) {
        radioPulse = true
    }
})

// Button A: local USB path test.
input.onButtonPressed(Button.A, function () {
    localSequence = (localSequence + 1) % 1000
    queueShot(2, localSequence)
})

// Button B: request an immediate short heartbeat.
input.onButtonPressed(Button.B, function () {
    statusFlashUntil = control.millis() + 220
    pendingHeartbeat = true
})

// Firmware marker. If B6 is not shown, the old build is still installed.
basic.showString("B6", 80)
serial.writeLine("R")

nextHeartbeatAt = control.millis() + 500
nextDisplayAt = control.millis()

basic.forever(function () {
    let now = control.millis()

    if (radioPulse) {
        radioPulse = false
        remoteSequence = (remoteSequence + 1) % 1000
        queueShot(1, remoteSequence)
    }

    if (pendingKind != 0) {
        let kind = pendingKind
        let sequence = pendingSequence
        pendingKind = 0

        if (kind == 1) {
            serial.writeLine("W|" + sequence)
        } else {
            serial.writeLine("T|" + sequence)
        }

        webFlashUntil = now + 220
        // Never place a heartbeat directly beside a WEB line on USB.
        nextHeartbeatAt = now + SERIAL_HEARTBEAT_MS
    }

    if (pendingHeartbeat) {
        pendingHeartbeat = false
        serial.writeLine("H")
    }

    if (now >= nextHeartbeatAt) {
        nextHeartbeatAt = now + SERIAL_HEARTBEAT_MS
        serial.writeLine("H")
    }

    if (now >= nextDisplayAt) {
        nextDisplayAt = now + 80
        renderDisplay(now)
    }

    basic.pause(10)
})
