// PDF de los informes: se abre la propia web en un Chrome sin interfaz (con la sesión del profesor) y se imprime cada informe.
const fs = require('fs');
const path = require('path');
const os = require('os');

function buscarChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const raiz = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome-headless-shell');
  try {
    const v = fs.readdirSync(raiz).sort().pop();
    const sub = fs.readdirSync(path.join(raiz, v))[0];
    return path.join(raiz, v, sub, 'chrome-headless-shell');
  } catch { return null; }
}

// Genera un PDF por cada URL y llama a alCrear(i, buffer). Un solo navegador para todos.
async function imprimir(urls, token, base, alCrear, cancelado) {
  const exe = buscarChrome();
  if (!exe) throw new Error('No encuentro Chrome en el servidor para generar los PDF (define CHROME_PATH).');
  const puppeteer = require('puppeteer-core');
  const nav = await puppeteer.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const pag = await nav.newPage();
    await pag.setCookie({ name: 'seg_sid', value: token, url: base });
    for (let i = 0; i < urls.length; i++) {
      if (cancelado()) return;
      await pag.goto(base + urls[i], { waitUntil: 'networkidle0', timeout: 60000 });
      await pag.waitForFunction('window.__listo === true', { timeout: 60000 });
      const pdf = await pag.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      await alCrear(i, Buffer.from(pdf));
    }
  } finally { await nav.close(); }
}

module.exports = { imprimir };
