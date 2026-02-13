/* audioWorker.js — Off-main-thread base64 → ArrayBuffer decoding */

self.onmessage = function (e) {
    const { id, base64 } = e.data;
    try {
        // Decode base64 to binary string
        const raw = atob(base64);
        const len = raw.length;
        const buffer = new ArrayBuffer(len);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < len; i++) {
            view[i] = raw.charCodeAt(i);
        }
        // Transfer the ArrayBuffer (zero-copy to main thread)
        self.postMessage({ id, buffer }, [buffer]);
    } catch (err) {
        self.postMessage({ id, error: err.message });
    }
};
