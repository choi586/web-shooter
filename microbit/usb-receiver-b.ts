// WEB SHOOTER — USB receiver B
// micro:bit v2 / MakeCode JavaScript

const RADIO_GROUP = 71
const RADIO_BAND = 7

const BEACON_INTERVAL_MS = 750
const SERIAL_HEARTBEAT_MS = 1000
const DUPLICATE_WINDOW_MS = 300

let radioPackets = 0
let webLines = 0
let duplicatePackets = 0
let invalidPackets = 0

let lastRadioBoot = -1
let lastRadioSequence = -1
let lastRadioUniqueAt = -1
let lastWebAt = -1

let localTestSequence = 0
let beaconSequence = 0

let webFlashUntil = 0
let badFlashUntil = 0
let statusFlashUntil = 0

let nextBeaconAt = 0
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

function injectLocalTest(): void {
    let now = control.millis()
    localTestSequence = (localTestSequence + 1) % 1000

    // Boot/session 0 is reserved for receiver-local tests.
    emitWebLine(0, localTestSequence, 0, 0, now)

    webLines += 1
    lastWebAt = now
    webFlashUntil = now + 220
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

    // Center dot means receiver ready.
    led.plot(2, 2)
}

serial.redirectToUSB()
serial.setBaudRate(BaudRate.BaudRate115200)
// MakeCode otherwise pads writeLine output to 32 characters.
serial.setWriteLinePadding(0)

radio.setGroup(RADIO_GROUP)
radio.setFrequencyBand(RADIO_BAND)
radio.setTransmitPower(7)

radio.onReceivedString(function (message: string) {
    let now = control.millis()

    // Read signal strength before transmitting the acknowledgement.
    let rssi = radio.receivedPacket(
        RadioPacketProperty.SignalStrength
    )

    radioPackets += 1

    let fields = message.split("|")

    if (fields.length != 4 || fields[0] != "W") {
        invalidPackets += 1
        badFlashUntil = now + 180
        return
    }

    let boot = parseInt(fields[1])
    let sequence = parseInt(fields[2])
    let senderTime = parseInt(fields[3])

    if (
        !(boot >= 1 && boot <= 255) ||
        !(sequence >= 0 && sequence <= 999) ||
        !(senderTime >= 0 && senderTime < 100000000)
    ) {
        invalidPackets += 1
        badFlashUntil = now + 180
        return
    }

    // Acknowledge every valid copy, including retries.
    radio.sendString("A|" + boot + "|" + sequence)

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
    lastWebAt = now

    webLines += 1
    webFlashUntil = now + 220

    emitWebLine(
        boot,
        sequence,
        senderTime,
        rssi,
        now
    )
})

// Optional newline-terminated commands from a serial console:
// PING, STATUS, TEST
serial.onDataReceived(
    serial.delimiters(Delimiters.NewLine),
    function () {
        let command = serial.readUntil(
            serial.delimiters(Delimiters.NewLine)
        )

        if (
            command.indexOf("PING") == 0 ||
            command.indexOf("WS1|PING") == 0
        ) {
            serial.writeLine(
                "WS1|PONG|" + control.millis()
            )
        } else if (
            command.indexOf("STATUS") == 0 ||
            command.indexOf("WS1|STATUS") == 0
        ) {
            emitStatus("STATUS")
            statusFlashUntil = control.millis() + 220
        } else if (
            command.indexOf("TEST") == 0 ||
            command.indexOf("WS1|TEST") == 0
        ) {
            injectLocalTest()
        }
    }
)

// Button A: inject a local shot without wrist unit A.
input.onButtonPressed(Button.A, function () {
    injectLocalTest()
})

// Button B: print status immediately.
input.onButtonPressed(Button.B, function () {
    emitStatus("STATUS")
    statusFlashUntil = control.millis() + 220
})

serial.writeLine(
    "WS1|READY|" +
    control.millis() + "|" +
    RADIO_GROUP + "|" +
    RADIO_BAND
)

nextBeaconAt = control.millis() + 200
nextHeartbeatAt = control.millis() + 500
nextDisplayAt = control.millis()

basic.forever(function () {
    let now = control.millis()

    if (now >= nextBeaconAt) {
        nextBeaconAt = now + BEACON_INTERVAL_MS
        beaconSequence = (beaconSequence + 1) % 100
        radio.sendString("B|" + beaconSequence)
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
