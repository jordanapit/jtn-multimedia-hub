// ==========================================
// PRELOAD DL - HILANGKAN SCROLLBAR GDrive
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    // Suntikkan CSS untuk mematikan scrollbar di halaman utama
    const style = document.createElement('style');
    style.innerHTML = `
        /* Matikan total scrollbar horizontal dan vertikal */
        html, body {
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
        }
    `;
    document.head.appendChild(style);
});