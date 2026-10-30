// ---- Stories Instagram du digest ----
let stBlobs = [];
$('#stMake').onclick = async () => {
  if (!dg) return;
  const b = $('#stMake'); b.disabled = true; b.textContent = 'Fabrication…';
  try {
    stBlobs = await window.makeStories(dg, { cover: $('#stCover').files[0], end: $('#stEnd').files[0], brand: brand.handle });
    const out = $('#stOut'); out.textContent = '';
    stBlobs.forEach((bl, i) => { const img = document.createElement('img'); img.src = URL.createObjectURL(bl); img.alt = 'Story ' + (i + 1); out.append(img); });
    $('#stActions').hidden = false;
    $('#stShare').hidden = !(navigator.canShare && navigator.canShare({ files: [new File([stBlobs[0]], 'a.png', { type: 'image/png' })] }));
  } catch (e) { alertMsg('Stories : ' + e.message); }
  b.disabled = false; b.textContent = 'Fabriquer les stories';
};
const stFiles = () => stBlobs.map((bl, i) => new File([bl], `cortege-${dg.date}-${i + 1}.png`, { type: 'image/png' }));
$('#stShare').onclick = () => navigator.share({ files: stFiles() }).catch(() => {});
$('#stSave').onclick = () => stFiles().forEach((f, i) => setTimeout(() => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.append(a); a.click(); a.remove();
}, i * 300));

