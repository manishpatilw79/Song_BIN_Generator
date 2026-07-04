// ---------------------------------------------------------------------------
// Command IDs - must stay in sync with SongCommandId in song_player.h
// ---------------------------------------------------------------------------
const CMD = {
    ON: 0,
    OFF: 1,
    TOGGLE: 2,
    EFFECT: 3,
    BRIGHTNESS: 4,
    SPEED: 5,
    INTENSITY: 6,
    PALETTE: 7,
    PRESET: 8,
    COLOR: 9
};

const CMD_NAMES = Object.fromEntries(Object.entries(CMD).map(([k, v]) => [v, k]));

// {r, g, b, w} - must stay in sync with SONG_COLOR_TABLE in song_player.cpp
const COLOR_TABLE = {
    1: [255, 0, 0, 0],        // red
    2: [0, 255, 0, 0],        // green
    3: [0, 0, 255, 0],        // blue
    4: [255, 255, 255, 0],    // white
    5: [255, 220, 0, 0],      // yellow
    6: [255, 0, 255, 0],      // purple
    7: [255, 160, 0, 0],      // orange
    8: [0, 255, 247, 0],      // cyan
    9: [255, 20, 147, 0],     // pink
    10: [128, 0, 255, 0],     // violet
    11: [245, 154, 154, 0],   // peacock
    12: [255, 180, 80, 0]     // warm white
};

const SONG_RECORD_SIZE = 7; // uint32 delayMs + uint8 cmdId + uint16 value

class SongBinCreator {
    constructor() {
        this.timeline = [];
        this.binData = null;
        this.originalFilename = '';
        this.init();
    }

    init() {
        document.getElementById('chooseFile').addEventListener('click', () => this.chooseFile());
        document.getElementById('loadFile').addEventListener('click', () => this.loadFile());
        document.getElementById('generateBin').addEventListener('click', () => this.generateBin());
        document.getElementById('verifyBin').addEventListener('click', () => this.verifyBin());
        document.getElementById('downloadBin').addEventListener('click', () => this.downloadBin());
        document.getElementById('clearAll').addEventListener('click', () => this.clear());
        document.getElementById('fileInput').addEventListener('change', (e) => this.onFileSelected(e));
    }

    chooseFile() {
        document.getElementById('fileInput').click();
    }

    onFileSelected(event) {
        const file = event.target.files[0];
        if (file) {
            this.originalFilename = file.name;
            document.getElementById('loadFile').disabled = false;
            this.addMessage(`File selected: ${file.name}`, 'info');
        }
    }

    loadFile() {
        const fileInput = document.getElementById('fileInput');
        const file = fileInput.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                if (file.name.endsWith('.bin')) {
                    this.loadBinFile(e.target.result);
                } else if (file.name.endsWith('.txt')) {
                    this.loadTxtFile(e.target.result);
                } else {
                    throw new Error('Unsupported file type. Please use .txt or .bin');
                }
            } catch (error) {
                this.addMessage(`Error: ${error.message}`, 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    loadTxtFile(arrayBuffer) {
        const decoder = new TextDecoder();
        const text = decoder.decode(arrayBuffer);
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        if (lines.length === 0) {
            throw new Error('Empty file');
        }

        this.timeline = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(/^([\d.]+)s\s+(.+)$/);

            if (!match) {
                throw new Error(`Line ${i + 1}: Invalid format "${line}". Expected: "0.00s COMMAND"`);
            }

            const timeSeconds = parseFloat(match[1]);
            const command = match[2].trim();

            if (isNaN(timeSeconds)) {
                throw new Error(`Line ${i + 1}: Invalid time "${match[1]}"`);
            }

            if (timeSeconds < 0) {
                throw new Error(`Line ${i + 1}: Negative time not allowed`);
            }

            const timeMs = Math.round(timeSeconds * 1000);

            const parsed = this.parseCommand(command);
            if (!parsed) {
                throw new Error(`Line ${i + 1}: Unknown command "${command}"`);
            }

            const json = this.buildDisplayJson(parsed.cmdId, parsed.value);

            this.timeline.push({ timeMs, command, cmdId: parsed.cmdId, value: parsed.value, json });
        }

        this.timeline.sort((a, b) => a.timeMs - b.timeMs);

        document.getElementById('generateBin').disabled = false;
        document.getElementById('verifyBin').disabled = true;
        document.getElementById('downloadBin').disabled = true;

        this.displayTimeline();
        this.addMessage(`Loaded ${this.timeline.length} events from TXT file`, 'success');
    }

    // Parses one TXT command into { cmdId, value }. No JSON is produced or
    // stored here anymore - only the compact numeric form that goes into
    // the BIN file. Returns null for an unrecognized command.
    parseCommand(command) {
        command = command.toUpperCase().trim();

        if (command === 'ON') return { cmdId: CMD.ON, value: 0 };
        if (command === 'OFF') return { cmdId: CMD.OFF, value: 0 };
        if (command === 'T') return { cmdId: CMD.TOGGLE, value: 0 };

        const match = command.match(/^([A-Z]+)(\d+)$/);
        if (!match) {
            return null;
        }

        const prefix = match[1];
        const value = parseInt(match[2], 10);

        if (prefix === 'E') {
            if (value > 255) throw new Error(`E value out of range: ${value}`);
            return { cmdId: CMD.EFFECT, value };
        }

        if (prefix === 'B') {
            if (value > 100) throw new Error(`B value out of range: ${value}`);
            // Stored as a raw 0-100 percentage; the firmware converts to
            // 0-255 with Arduino's map(), same as buildDisplayJson() below.
            return { cmdId: CMD.BRIGHTNESS, value };
        }

        if (prefix === 'S') {
            if (value > 255) throw new Error(`S value out of range: ${value}`);
            return { cmdId: CMD.SPEED, value };
        }

        if (prefix === 'I') {
            if (value > 255) throw new Error(`I value out of range: ${value}`);
            return { cmdId: CMD.INTENSITY, value };
        }

        if (prefix === 'P') {
            if (value > 255) throw new Error(`P value out of range: ${value}`);
            return { cmdId: CMD.PALETTE, value };
        }

        if (prefix === 'PS') {
            return { cmdId: CMD.PRESET, value };
        }

        if (prefix === 'C') {
            if (!COLOR_TABLE[value]) {
                throw new Error(`C value out of range: ${value}. Valid: 1-12`);
            }
            return { cmdId: CMD.COLOR, value };
        }

        return null;
    }

    // Reconstructs the exact JSON packet the firmware will generate for a
    // given (cmdId, value) pair. Used only for on-screen preview/verification
    // - it is never written to the BIN file. Mirrors SongPlayer::buildJson()
    // in song_player.cpp exactly, including the brightness map() truncation.
    buildDisplayJson(cmdId, value) {
        switch (cmdId) {
            case CMD.ON:
                return JSON.stringify({ on: true });

            case CMD.OFF:
                return JSON.stringify({ on: false });

            case CMD.TOGGLE:
                return JSON.stringify({ on: 't' });

            case CMD.EFFECT:
                return JSON.stringify({ seg: [{ fx: value }] });

            case CMD.BRIGHTNESS: {
                // Arduino map(value, 0, 100, 0, 255) truncates toward zero.
                const brightness = Math.trunc((value * 255) / 100);
                return JSON.stringify({ bri: brightness });
            }

            case CMD.SPEED:
                return JSON.stringify({ seg: [{ sx: value }] });

            case CMD.INTENSITY:
                return JSON.stringify({ seg: [{ ix: value }] });

            case CMD.PALETTE:
                return JSON.stringify({ seg: [{ pal: value }] });

            case CMD.PRESET:
                return JSON.stringify({ ps: value });

            case CMD.COLOR: {
                const c = COLOR_TABLE[value];
                if (!c) return null;
                return JSON.stringify({ seg: [{ col: [c] }] });
            }

            default:
                return null;
        }
    }

    displayTimeline() {
        const container = document.getElementById('timelineContainer');
        container.innerHTML = '';

        if (this.timeline.length === 0) {
            container.innerHTML = '<p class="empty-state">Load a TXT file to see the timeline</p>';
            return;
        }

        let previousTime = 0;
        for (const item of this.timeline) {
            const deltaMs = item.timeMs - previousTime;
            const timeS = (item.timeMs / 1000).toFixed(2);
            const deltaS = (deltaMs / 1000).toFixed(3);

            const div = document.createElement('div');
            div.className = 'timeline-item';
            div.innerHTML = `
                <div class="time">${timeS}s</div>
                <div class="delta">Δ ${deltaMs}ms (${deltaS}s)</div>
                <div class="command">${item.command}</div>
                <div class="json">${item.json}</div>
            `;
            container.appendChild(div);
            previousTime = item.timeMs;
        }
    }

    // Writes each timeline entry as a fixed 7-byte record:
    //   [0:4]  delayMs  (uint32, LE)
    //   [4]    cmdId    (uint8)
    //   [5:7]  value    (uint16, LE)
    // No JSON is stored in the file at all.
    generateBin() {
        if (this.timeline.length === 0) {
            this.addMessage('No timeline to generate', 'error');
            return;
        }

        const buffer = new Uint8Array(this.timeline.length * SONG_RECORD_SIZE);
        const view = new DataView(buffer.buffer);
        let previousTime = 0;
        let offset = 0;

        for (const item of this.timeline) {
            const deltaMs = item.timeMs - previousTime;

            view.setUint32(offset, deltaMs, true);
            view.setUint8(offset + 4, item.cmdId);
            view.setUint16(offset + 5, item.value, true);

            offset += SONG_RECORD_SIZE;
            previousTime = item.timeMs;
        }

        this.binData = buffer;
        document.getElementById('downloadBin').disabled = false;
        document.getElementById('verifyBin').disabled = false;
        this.addMessage(`Generated BIN: ${this.binData.length} bytes`, 'success');
    }

    verifyBin() {
        if (!this.binData) {
            const fileInput = document.getElementById('fileInput');
            if (!fileInput.files[0] || !fileInput.files[0].name.endsWith('.bin')) {
                this.addMessage('Load a BIN file or generate one first', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                this.binData = new Uint8Array(e.target.result);
                this.performVerification();
            };
            reader.readAsArrayBuffer(fileInput.files[0]);
        } else {
            this.performVerification();
        }
    }

    performVerification() {
        const container = document.getElementById('verifyContainer');
        container.innerHTML = '';

        if (!this.binData || this.binData.length === 0) {
            this.addMessage('No BIN data to verify', 'error');
            return;
        }

        const records = [];
        let offset = 0;
        let recordNum = 0;

        try {
            if (this.binData.length % SONG_RECORD_SIZE !== 0) {
                throw new Error(`Corrupt BIN: length ${this.binData.length} is not a multiple of ${SONG_RECORD_SIZE}`);
            }

            const view = new DataView(this.binData.buffer, this.binData.byteOffset, this.binData.byteLength);

            while (offset < this.binData.length) {
                const delayMs = view.getUint32(offset, true);
                const cmdId = view.getUint8(offset + 4);
                const value = view.getUint16(offset + 5, true);
                offset += SONG_RECORD_SIZE;

                const json = this.buildDisplayJson(cmdId, value);
                if (json === null) {
                    throw new Error(`Record ${recordNum}: Unknown command ID (${cmdId})`);
                }

                records.push({ delayMs, cmdId, value, json });
                recordNum++;
            }

            for (const [idx, record] of records.entries()) {
                const cmdName = CMD_NAMES[record.cmdId] || `?${record.cmdId}`;
                const div = document.createElement('div');
                div.className = 'verify-record';
                div.innerHTML = `
                    <div class="detail">
                        <span class="label">Record ${idx}</span>
                        <span class="value">Delay: ${record.delayMs}ms | Cmd: ${cmdName} (${record.cmdId}) | Value: ${record.value}</span>
                    </div>
                    <div class="json">${record.json}</div>
                `;
                container.appendChild(div);
            }

            this.addMessage(`Verified: ${records.length} records, ${this.binData.length} bytes total`, 'success');
        } catch (error) {
            const div = document.createElement('div');
            div.className = 'verify-record error';
            div.innerHTML = `<div class="detail" style="color: var(--danger);">${error.message}</div>`;
            container.appendChild(div);
            this.addMessage(`Verification failed: ${error.message}`, 'error');
        }
    }

    loadBinFile(arrayBuffer) {
        this.binData = new Uint8Array(arrayBuffer);
        document.getElementById('downloadBin').disabled = false;
        document.getElementById('verifyBin').disabled = false;
        this.addMessage(`Loaded BIN file: ${this.binData.length} bytes`, 'success');
        this.performVerification();
    }

    downloadBin() {
        if (!this.binData) {
            this.addMessage('No BIN data to download', 'error');
            return;
        }

        let filename = this.originalFilename;
        if (!filename || filename.endsWith('.txt')) {
            if (filename) {
                filename = filename.replace(/\.txt$/i, '.bin');
            } else {
                filename = 'song.bin';
            }
        }

        const blob = new Blob([this.binData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.addMessage(`Downloaded: ${filename}`, 'success');
    }

    addMessage(text, type = 'info') {
        const container = document.getElementById('messageContainer');
        const div = document.createElement('div');
        div.className = `message message-${type}`;
        div.textContent = text;
        container.insertBefore(div, container.firstChild);

        if (container.children.length > 10) {
            container.removeChild(container.lastChild);
        }
    }

    clear() {
        this.timeline = [];
        this.binData = null;
        this.originalFilename = '';
        document.getElementById('fileInput').value = '';
        document.getElementById('loadFile').disabled = true;
        document.getElementById('generateBin').disabled = true;
        document.getElementById('verifyBin').disabled = true;
        document.getElementById('downloadBin').disabled = true;
        document.getElementById('timelineContainer').innerHTML = '<p class="empty-state">Load a TXT file to see the timeline</p>';
        document.getElementById('verifyContainer').innerHTML = '<p class="empty-state">Generate and verify a BIN file</p>';
        document.getElementById('messageContainer').innerHTML = '<p class="message message-info">Ready</p>';
        this.addMessage('Cleared', 'info');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SongBinCreator();
});
