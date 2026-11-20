// Leitura do extrato bancário importado (M32; ficha, seção 6): OFX (SGML ou XML, os blocos STMTTRN) e CSV (data;valor;
// histórico[;documento], com cabeçalho opcional). Só o conteúdo do arquivo; o hash e a guarda no S3 são do servidor.
export interface LinhaLida {
  readonly data: string;
  readonly valor: number;
  readonly historico: string;
  readonly documento: string;
}

export class ErroExtrato extends Error {
  override readonly name = 'ErroExtrato';
}

const valorBr = (t: string): number => {
  const s = t.trim().replace(/\s/g, '');
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  if (!Number.isFinite(n)) throw new ErroExtrato(`Valor inválido no extrato: ${t.slice(0, 20)}`);
  return Math.round(n * 100) / 100;
};

const dataBr = (t: string): string => {
  const s = t.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const o = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (o) return `${o[1]}-${o[2]}-${o[3]}`;
  throw new ErroExtrato(`Data inválida no extrato: ${s.slice(0, 20)}`);
};

function tag(bloco: string, nome: string): string {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(bloco);
  return (m?.[1] ?? '').trim();
}

export function lerOfx(conteudo: string): LinhaLida[] {
  const blocos = conteudo.split(/<STMTTRN>/i).slice(1);
  if (blocos.length === 0) throw new ErroExtrato('O arquivo OFX não tem lançamentos (STMTTRN).');
  return blocos.map((b) => ({
    data: dataBr(tag(b, 'DTPOSTED')),
    valor: valorBr(tag(b, 'TRNAMT')),
    historico: (tag(b, 'MEMO') || tag(b, 'NAME')).slice(0, 200),
    documento: (tag(b, 'CHECKNUM') || tag(b, 'FITID')).slice(0, 40),
  }));
}

export function lerCsv(conteudo: string): LinhaLida[] {
  const linhas = conteudo
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const dados = linhas.filter((l) => !/^data\s*[;,]/i.test(l));
  if (dados.length === 0) throw new ErroExtrato('O CSV não tem lançamentos.');
  return dados.map((l) => {
    const [d = '', v = '', h = '', doc = ''] = l.split(';');
    return {
      data: dataBr(d),
      valor: valorBr(v),
      historico: h.trim().slice(0, 200),
      documento: doc.trim().slice(0, 40),
    };
  });
}

export function lerExtrato(origem: 'ofx' | 'csv' | 'api', conteudo: string): LinhaLida[] {
  return origem === 'ofx' ? lerOfx(conteudo) : lerCsv(conteudo);
}
