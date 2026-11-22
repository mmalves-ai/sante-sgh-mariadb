// Apoio dos testes de integração do documento: veraPDF e exiftool por imagem Docker com tag e digest, sem
// rede (`--network none`), sobre uma pasta temporária dentro do repositório (POL-4).
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  type ArmazemArquivosLocal,
  type ContextoNucleo,
  criarArmazemLocal,
  criarPastaArquivosTeste,
  NucleoProprio,
  type PastaArquivosTeste,
} from '@sgh/nucleo';
import { armazemSobDemanda } from './infra/arquivos.js';

export const IMAGEM_VERAPDF =
  'verapdf/cli:v1.30.2@sha256:d5ee329657cf9bc4b2400392dd54c7d0a0ce9980ff6fa2da5590eebeec007cdb';
export const IMAGEM_GOTENBERG =
  'gotenberg/gotenberg:8.28.0@sha256:f172b1ce5ec7516ab9452d33bfe3f198d778d3de39655825aa550f4a33946666';

export const raiz = resolve(import.meta.dirname, '../../../../..');

export function pastaTemporaria(prefixo: string): string {
  const base = resolve(raiz, '.tmp');
  mkdirSync(base, { recursive: true });
  const pasta = mkdtempSync(join(base, prefixo));
  chmodSync(pasta, 0o755); // o veraPDF roda como outro usuário no contêiner (só leitura)
  return pasta;
}

export interface ResultadoVeraPdf {
  readonly arquivo: string;
  readonly conforme: boolean;
  readonly regrasFalhas: number;
  readonly checagensFalhas: number;
  readonly perfil: string;
}

export function verapdf(pasta: string, arquivos: Record<string, Uint8Array>): ResultadoVeraPdf[] {
  for (const [nome, bytes] of Object.entries(arquivos))
    writeFileSync(join(pasta, nome), bytes, { mode: 0o644 });
  const r = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${pasta}:/data:ro`,
      IMAGEM_VERAPDF,
      '--flavour',
      '2b',
      '--format',
      'json',
      ...Object.keys(arquivos).map((n) => `/data/${n}`),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0 && !r.stdout) throw new Error(`veraPDF não rodou: ${r.stderr.slice(0, 300)}`);
  const json = JSON.parse(r.stdout) as {
    report: {
      jobs: {
        itemDetails: { name: string };
        validationResult: {
          compliant: boolean;
          profileName: string;
          details: { failedRules: number; failedChecks: number };
        }[];
      }[];
    };
  };
  return json.report.jobs.map((j) => {
    const v = j.validationResult[0]!;
    return {
      arquivo: j.itemDetails.name.replace('/data/', ''),
      conforme: v.compliant,
      regrasFalhas: v.details.failedRules,
      checagensFalhas: v.details.failedChecks,
      perfil: v.profileName,
    };
  });
}

/** Metadados do PDF lidos pelo exiftool da própria imagem do Gotenberg (sem rede). */
export function metadadosPdf(pasta: string, arquivo: string): Record<string, string> {
  const r = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${pasta}:/data:ro`,
      '--entrypoint',
      'exiftool',
      IMAGEM_GOTENBERG,
      '-j',
      '-Title',
      '-Keywords',
      '-XMP-pdfaid:Part',
      '-XMP-pdfaid:Conformance',
      `/data/${arquivo}`,
    ],
    { encoding: 'utf8' },
  );
  const [m] = JSON.parse(r.stdout) as Record<string, string>[];
  return Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, String(v)]));
}

/** Página 1 do PDF em tons de cinza (PGM) pelo pdftoppm do sistema, com o cache do fontconfig no projeto. */
export function rasterizarPagina1(pasta: string, nome: string, pdf: Uint8Array, dpi = 30): Buffer {
  const arquivo = join(pasta, `${nome}.pdf`);
  writeFileSync(arquivo, pdf, { mode: 0o644 });
  const r = spawnSync(
    'pdftoppm',
    ['-gray', '-r', String(dpi), '-f', '1', '-l', '1', '-singlefile', arquivo, join(pasta, nome)],
    {
      encoding: 'utf8',
      env: { ...process.env, XDG_CACHE_HOME: resolve(raiz, '.cache-local') },
    },
  );
  if (r.status !== 0) throw new Error(`pdftoppm falhou: ${r.stderr.slice(0, 200)}`);
  return readFileSync(join(pasta, `${nome}.pgm`));
}

interface Pgm {
  readonly largura: number;
  readonly altura: number;
  readonly pixels: Buffer;
}

function lerPgm(b: Buffer): Pgm {
  const cab = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(b.subarray(0, 64).toString('latin1'));
  if (!cab) throw new Error('PGM inválido');
  return { largura: Number(cab[1]), altura: Number(cab[2]), pixels: b.subarray(cab[0].length) };
}

/**
 * Snapshot visual (padrão provisório do M09 até o modelo real do M23): compara a página com a referência
 * versionada pixel a pixel. Conta como diferente o pixel que muda mais de 64 níveis; o QR e a data mudam a
 * cada emissão, então a tolerância é uma fração pequena da página. SGH_ATUALIZAR_SNAPSHOT=sim regrava.
 */
export function compararSnapshot(
  atual: Buffer,
  referencia: string,
): { criado: boolean; diferentes: number; total: number; fracao: number; mesmoTamanho: boolean } {
  if (!existsSync(referencia) || process.env['SGH_ATUALIZAR_SNAPSHOT'] === 'sim') {
    mkdirSync(resolve(referencia, '..'), { recursive: true });
    writeFileSync(referencia, atual);
    return { criado: true, diferentes: 0, total: 0, fracao: 0, mesmoTamanho: true };
  }
  const a = lerPgm(atual);
  const r = lerPgm(readFileSync(referencia));
  const mesmoTamanho = a.largura === r.largura && a.altura === r.altura;
  const total = a.largura * a.altura;
  let diferentes = 0;
  if (mesmoTamanho)
    for (let i = 0; i < total; i++) if (Math.abs((a.pixels[i] ?? 0) - (r.pixels[i] ?? 0)) > 64) diferentes++;
  return { criado: false, diferentes, total, fracao: mesmoTamanho ? diferentes / total : 1, mesmoTamanho };
}

/**
 * Arquivos dos testes de PDF (ADR 0004): a porta de arquivos no disco local sobre o cliente de teste
 * (SGH_CLIENTE_TESTE) e uma pasta temporária como raiz, apagada no fim. `armazem` pode ser passado ao serviço antes do
 * `preparar()` (é criado no primeiro uso).
 */
export interface ArquivosDeTeste {
  readonly cliente: string;
  readonly armazem: ReturnType<typeof armazemSobDemanda>;
  contexto(): ContextoNucleo;
  local(): ArmazemArquivosLocal;
  /** Nome do banco do cliente (a pasta dele na raiz). */
  banco(): Promise<string>;
  preparar(): Promise<void>;
  encerrar(): Promise<void>;
}

export function arquivosDeTeste(): ArquivosDeTeste {
  const cliente = process.env['SGH_CLIENTE_TESTE']?.trim() || 'teste_nucleo';
  let nucleo: NucleoProprio | null = null;
  let pasta: PastaArquivosTeste | null = null;
  let local: ArmazemArquivosLocal | null = null;
  const exigir = (): ArmazemArquivosLocal => {
    if (!local) throw new Error('arquivosDeTeste: chame preparar() no beforeAll.');
    return local;
  };
  return {
    cliente,
    armazem: armazemSobDemanda(exigir),
    contexto: () => ({ cliente, estabelecimento: null, usuario: null, correlacao: 'teste-arquivos-pdf' }),
    local: exigir,
    banco: async () => (await nucleo!.cliente(cliente)).banco,
    async preparar() {
      nucleo = new NucleoProprio();
      pasta = await criarPastaArquivosTeste(cliente);
      local = criarArmazemLocal(nucleo, { raiz: pasta.raiz });
    },
    async encerrar() {
      await pasta?.apagar();
      await nucleo?.encerrar();
    },
  };
}
