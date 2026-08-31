// WEB SHOOTER — USB receiver B
// micro:bit v2 / MakeCode JavaScript
// Stability build: one-way Radio and single-owner USB Serial output.

const RADIO_GROUP = 71
const RADIO_BAND = 7

const SERIAL_HEARTBEAT_MS = 1000
const DUPLICATE_WINDOW_MS = 1200

let radioPackets = 0
let webLines = 0
let duplicatePackets = 0
let invalidPackets = 0

let lastRadioBoot = -1
let lastRadioSequence = -1
let lastRadioUniqueAt = -1
let lastWebAt = -1

let localTestSequence = 0

// Radio and button callbacks only place work in this mailbox. The forever
// loop below is the only fiber that writes to USB Serial.
let pendingWeb = false
let pendingBoot = 0
let pendingSequence = 0
let pendingSenderTime = 0
let pendingRssi = 0
let pendingReceiverTime = 0
let pendingStatus = false

let webFlashUntil = 0
let badFlashUntil = 0
let statusFlashUntil = 0

let nextHeartbeatAt = 0
let nextDisplayAt = 0

function lastWebAge(now: number): number {
    if (lastWebAt < 0) {
        return -1
    }
    return now - lastWebAt
}

function emitWebLine(
    boot: number,
    sequence: number,
    senderTime: number,
    rssi: number,
    receiverTime: number
): void {
    serial.writeLine(
        "WS1|WEB|" +
        boot + "|" +
        sequence + "|" +
        senderTime + "|" +
        rssi + "|" +
        receiverTime
    )
}

function emitStatus(type: string): void {
    let now = control.millis()

    serial.writeLine(
        "WS1|" + type + "|" +
        now + "|" +
        lastWebAge(now) + "|" +
        radioPackets + "|" +
        webLines + "|" +
        duplicatePackets + "|" +
        invalidPackets
    )
}

function queueWeb(
    boot: number,
    sequence: number,
    senderTime: number,
    rssi: number,
    receiverTime: number
): void {
    pendingBoot = boot
    pendingSequence = sequence
    pendingSenderTime = senderTime
    pendingRssi = rssi
    pendingReceiverTime = receiverTime
    pendingWeb = true
}

function queueLocalTest(): void {
    let now = control.millis()
    localTestSequence = (localTestSequence + 1) % 1000

    // Boot/session 0 is reserved for receiver-local tests.
    queueWeb(0, localTestSequence, 0, 0, now)
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

function drawError(): void {
    led.plot(0, 0)
    led.plot(1, 1)
    led.plot(2, 2)
    led.plot(3, 3)
    led.plot(4, 4)
    led.plot(4, 0)
    led.plot(3, 1)
    led.plot(1, 3)
    led.plot(0, 4)
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

    if (now < badFlashUntil) {
        drawError()
        return
    }

    if (now < webFlashUntil) {
        drawBurst()
        return
    }

    if (now < statusFlashUntil) {
        drawCheck()
        return
    }

    // Center dot means receiver and USB heartbeat loop are ready.
    led.plot(2, 2)
}

serial.redirectToUSB()
serial.setBaudRate(BaudRate.BaudRate115200)
// MakeCode otherwise pads writeLine output to 32 characters.
serial.setWriteLinePadding(0)

radio.setGroup(RADIO_GROUP)
radio.setFrequencyBand(RADIO_BAND)

radio.onReceivedNumber(function (packet: number) {
    let now = control.millis()

    // This callback never transmits Radio and never writes USB Serial.
    let rssi = radio.receivedPacket(
        RadioPacketProperty.SignalStrength
    )

    radioPackets += 1

    let boot = Math.idiv(packet, 1000)
    let sequence = packet % 1000

    if (
        packet != Math.floor(packet) ||
        !(boot >= 1 && boot <= 255) ||
        !(sequence >= 0 && sequence <= 999)
    ) {
        invalidPackets += 1
        badFlashUntil = now + 180
        return
    }

    let duplicate =
        lastRadioUniqueAt >= 0 &&
        boot == lastRadioBoot &&
        sequence == lastRadioSequence &&
        now - lastRadioUniqueAt <= DUPLICATE_WINDOW_MS

    if (duplicate) {
        duplicatePackets += 1
        return
    }

    lastRadioBoot = boot
    lastRadioSequence = sequence
    lastRadioUniqueAt = now

    queueWeb(
        boot,
        sequence,
        now,
        rssi,
        now
    )
})

// Button A: queue a local shot without wrist unit A.
input.onButtonPressed(Button.A, function () {
    queueLocalTest()
})

// Button B: queue status output. Serial still writes from the main loop only.
input.onButtonPressed(Button.B, function () {
    pendingStatus = true
    statusFlashUntil = control.millis() + 220
})

serial.writeLine(
    "WS1|READY|" +
    control.millis() + "|" +
    RADIO_GROUP + "|" +
    RADIO_BAND
)

nextHeartbeatAt = control.millis() + 500
nextDisplayAt = control.millis()

basic.forever(function () {
    let now = control.millis()

    if (pendingWeb) {
        // Copy the mailbox before allowing the Radio fiber to fill it again.
        let boot = pendingBoot
        let sequence = pendingSequence
        let senderTime = pendingSenderTime
        let rssi = pendingRssi
        let receiverTime = pendingReceiverTime
        pendingWeb = false

        emitWebLine(
            boot,
            sequence,
            senderTime,
            rssi,
            receiverTime
        )

        webLines += 1
        lastWebAt = now
        webFlashUntil = now + 220
    }

    if (pendingStatus) {
        pendingStatus = false
        emitStatus("STATUS")
    }

    if (now >= nextHeartbeatAt) {
        nextHeartbeatAt = now + SERIAL_HEARTBEAT_MS
        emitStatus("HEARTBEAT")
    }

    if (now >= nextDisplayAt) {
        nextDisplayAt = now + 80
        renderDisplay(now)
    }

    basic.pause(10)
})
