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

            const json = this.parseCommand(command);
            if (!json) {
                throw new Error(`Line ${i + 1}: Unknown command "${command}"`);
            }

            this.timeline.push({ timeMs, command, json });
        }

        this.timeline.sort((a, b) => a.timeMs - b.timeMs);

        document.getElementById('generateBin').disabled = false;
        document.getElementById('verifyBin').disabled = true;
        document.getElementById('downloadBin').disabled = true;

        this.displayTimeline();
        this.addMessage(`Loaded ${this.timeline.length} events from TXT file`, 'success');
    }

    parseCommand(command) {
        command = command.toUpperCase().trim();

        if (command === 'ON') {
            return JSON.stringify({ on: true });
        }

        if (command === 'OFF') {
            return JSON.stringify({ on: false });
        }

        if (command === 'T') {
            return JSON.stringify({ on: 't' });
        }

        const match = command.match(/^([A-Z]+)(\d+)$/);
        if (!match) {
            return null;
        }

        const prefix = match[1];
        const value = parseInt(match[2], 10);

        if (prefix === 'E') {
            if (value > 255) throw new Error(`E value out of range: ${value}`);
            return JSON.stringify({ seg: [{ fx: value }] });
        }

        if (prefix === 'B') {
            if (value > 100) throw new Error(`B value out of range: ${value}`);
            const brightness = Math.round((value * 255) / 100);
            return JSON.stringify({ bri: brightness });
        }

        if (prefix === 'S') {
            if (value > 255) throw new Error(`S value out of range: ${value}`);
            return JSON.stringify({ seg: [{ sx: value }] });
        }

        if (prefix === 'I') {
            if (value > 255) throw new Error(`I value out of range: ${value}`);
            return JSON.stringify({ seg: [{ ix: value }] });
        }

        if (prefix === 'P') {
            if (value > 255) throw new Error(`P value out of range: ${value}`);
            return JSON.stringify({ seg: [{ pal: value }] });
        }

        if (prefix === 'PS') {
            return JSON.stringify({ ps: value });
        }

        if (prefix === 'C') {
            const colors = {
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

            if (!colors[value]) {
                throw new Error(`C value out of range: ${value}. Valid: 1-12`);
            }

            return JSON.stringify({ seg: [{ col: [colors[value]] }] });
        }

        return null;
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

    generateBin() {
        if (this.timeline.length === 0) {
            this.addMessage('No timeline to generate', 'error');
            return;
        }

        const buffer = [];
        let previousTime = 0;

        for (const item of this.timeline) {
            const deltaMs = item.timeMs - previousTime;
            const jsonBytes = new TextEncoder().encode(item.json);

            const delayArray = new Uint8Array(4);
            new DataView(delayArray.buffer).setUint32(0, deltaMs, true);
            buffer.push(...delayArray);

            const lengthArray = new Uint8Array(2);
            new DataView(lengthArray.buffer).setUint16(0, jsonBytes.length, true);
            buffer.push(...lengthArray);

            buffer.push(...jsonBytes);

            previousTime = item.timeMs;
        }

        this.binData = new Uint8Array(buffer);
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
            while (offset < this.binData.length) {
                if (offset + 6 > this.binData.length) {
                    throw new Error('Corrupt BIN: Incomplete header at end of file');
                }

                const delayMs = new DataView(this.binData.buffer, offset, 4).getUint32(0, true);
                offset += 4;

                const jsonLen = new DataView(this.binData.buffer, offset, 2).getUint16(0, true);
                offset += 2;

                if (jsonLen === 0) {
                    throw new Error(`Record ${recordNum}: Invalid JSON length (0)`);
                }

                if (offset + jsonLen > this.binData.length) {
                    throw new Error(`Record ${recordNum}: JSON exceeds file bounds`);
                }

                const jsonBytes = this.binData.slice(offset, offset + jsonLen);
                const json = new TextDecoder().decode(jsonBytes);
                offset += jsonLen;

                try {
                    JSON.parse(json);
                } catch (e) {
                    throw new Error(`Record ${recordNum}: Invalid JSON - ${e.message}`);
                }

                records.push({ delayMs, jsonLen, json });
                recordNum++;
            }

            for (const [idx, record] of records.entries()) {
                const div = document.createElement('div');
                div.className = 'verify-record';
                div.innerHTML = `
                    <div class="detail">
                        <span class="label">Record ${idx}</span>
                        <span class="value">Delay: ${record.delayMs}ms | Length: ${record.jsonLen}B</span>
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
