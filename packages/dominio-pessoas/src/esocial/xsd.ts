// Regra 9 da ficha do M53: evento do eSocial só segue para lote depois de validado no XSD oficial do leiaute vigente.
// O XSD é o pacote oficial publicado pelo eSocial (pasta `xsd/<versão>`, bytes originais, conferidos pelo SHA256SUMS:
// arquivo alterado ou faltando recusa a validação), validado pelo libxml2 em WebAssembly (xmllint-wasm), sem rede.
//
// D-XSD-536 (POL-5): o catálogo de esquemas do banco (FPESOCARQXSD, 373) traz o XSD de cada evento, mas não o
// `tipos.xsd` que todos incluem desde o leiaute S-1.0; sem ele nenhum evento valida. O pacote oficial completo fica
// versionado aqui e o catálogo do banco é lido só para mostrar a versão vigente de cada evento (o importador do M13
// mantém o catálogo).
//
// D-ASSINATURA-536 (POL-5): o XSD exige a assinatura digital (`ds:Signature`) no fim do evento, que só existe no envio
// (certificado do empregador). Antes dela o evento é conferido com uma assinatura provisória de forma válida (valores
// zerados), trocada pela real na transmissão, que valida de novo.
import type { LeiauteEsocial } from '@sgh/contratos';

export interface ArquivoEsquemaEsocial {
  readonly fileName: string;
  readonly contents: Uint8Array;
}

export class ErroEsquemaEsocial extends Error {
  override readonly name = 'ErroEsquemaEsocial';
}

// D-XSD-NODE-536 (sessão 3, achado do E2E): os módulos do Node entram por importação tardia, como o `xmllint-wasm`. O
// índice de @sgh/dominio-pessoas chega à web (a admissão, a folha), e a importação estática de `node:fs` quebrava a
// navegação no navegador ("Module node:fs has been externalized").
async function moduloNode() {
  const [fs, path, url] = await Promise.all([import('node:fs'), import('node:path'), import('node:url')]);
  return {
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    dirname: path.dirname,
    resolve: path.resolve,
    pathToFileURL: url.pathToFileURL,
  };
}

const PASTA_FONTE = (leiaute: LeiauteEsocial) => new URL(`./xsd/${leiaute}/`, import.meta.url);

/**
 * A pasta do XSD do leiaute: a do código-fonte, ESOCIAL_XSD_PASTA na implantação, a vizinha do main.js quando a API roda
 * empacotada (o build copia a pasta) e, por último, a do repositório a partir do diretório atual.
 */
export async function pastaXsdEsocial(leiaute: LeiauteEsocial): Promise<URL> {
  const { existsSync, dirname, resolve, pathToFileURL } = await moduloNode();
  const candidatos = [
    PASTA_FONTE(leiaute),
    ...(process.env['ESOCIAL_XSD_PASTA']
      ? [pathToFileURL(`${resolve(process.env['ESOCIAL_XSD_PASTA'], leiaute)}/`)]
      : []),
    ...(process.argv[1]
      ? [pathToFileURL(`${resolve(dirname(process.argv[1]), 'xsd-esocial', leiaute)}/`)]
      : []),
    pathToFileURL(`${resolve(process.cwd(), 'packages/dominio-pessoas/src/esocial/xsd', leiaute)}/`),
  ];
  return candidatos.find((u) => existsSync(new URL('SHA256SUMS', u))) ?? PASTA_FONTE(leiaute);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lê os XSD do leiaute e confere cada um contra o SHA256SUMS versionado. */
export async function carregarEsquemasEsocial(pasta: URL): Promise<ArquivoEsquemaEsocial[]> {
  const { readFileSync } = await moduloNode();
  const manifesto = readFileSync(new URL('SHA256SUMS', pasta), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(l);
      if (!m) throw new ErroEsquemaEsocial(`Linha inválida no SHA256SUMS: ${l}`);
      return { hash: m[1]!, arquivo: m[2]! };
    });
  for (const comum of ['tipos.xsd', 'xmldsig-core-schema.xsd'])
    if (!manifesto.some((m) => m.arquivo === comum))
      throw new ErroEsquemaEsocial(`${comum} fora do SHA256SUMS.`);
  const arquivos: ArquivoEsquemaEsocial[] = [];
  for (const { hash, arquivo } of manifesto) {
    const contents = new Uint8Array(readFileSync(new URL(arquivo, pasta)));
    if ((await sha256Hex(contents)) !== hash)
      throw new ErroEsquemaEsocial(`XSD ${arquivo} alterado (SHA-256 não confere com o SHA256SUMS).`);
    arquivos.push({ fileName: arquivo, contents });
  }
  return arquivos;
}

const cache = new Map<string, Promise<ArquivoEsquemaEsocial[]>>();

/** Os esquemas do leiaute, carregados e conferidos uma vez por processo. */
export function esquemasDoLeiaute(leiaute: LeiauteEsocial): Promise<ArquivoEsquemaEsocial[]> {
  let p = cache.get(leiaute);
  if (!p) {
    p = pastaXsdEsocial(leiaute).then(carregarEsquemasEsocial);
    p.catch(() => cache.delete(leiaute));
    cache.set(leiaute, p);
  }
  return p;
}

export interface ResultadoXsdEsocial {
  readonly valido: boolean;
  readonly erros: readonly string[];
}

/** Valida o XML do evento (com a assinatura, real ou provisória) no XSD do elemento `raiz` (ex.: evtAdmissao). */
export async function validarEventoNoXsd(
  xml: string,
  raiz: string,
  esquemas: readonly ArquivoEsquemaEsocial[],
): Promise<ResultadoXsdEsocial> {
  const principal = esquemas.find((e) => e.fileName === `${raiz}.xsd`);
  if (!principal) throw new ErroEsquemaEsocial(`Esquema ${raiz}.xsd ausente no leiaute.`);
  const preload = esquemas.filter(
    (e) => e.fileName === 'tipos.xsd' || e.fileName === 'xmldsig-core-schema.xsd',
  );
  // Importação tardia: o índice do pacote também chega à tela (web), que nunca valida XSD; o wasm só carrega no servidor.
  const { validateXML } = await import('xmllint-wasm');
  const r = await validateXML({
    xml: [{ fileName: 'evento.xml', contents: new TextEncoder().encode(xml) }],
    schema: [principal],
    preload,
    // Sem rede: o DTD citado pelo xmldsig-core-schema.xsd nunca é baixado.
    modifyArguments: (args) => ['--nonet', ...args],
  });
  return {
    valido: r.valid,
    erros: r.errors
      .map((e) => errosSemValores(e.message.trim().replace(/^evento\.xml:\d+:\s*/, '')))
      .slice(0, 50),
  };
}

/**
 * A mensagem do validador sem o valor do campo (achado do corretor do M53.6): o xmllint repete o valor recusado
 * (`The value '…' is not accepted by the pattern …`, `'…' is not a valid value of …`), que no evento do trabalhador é
 * CPF, nome, nascimento, endereço ou salário. Ficam o elemento, a faceta e a regra (padrão, tamanho, lista), que são do
 * leiaute; o valor vira "(valor omitido)", e todo número de 11 dígitos ou mais que sobrar também.
 */
export function errosSemValores(m: string): string {
  return m
    .replace(/The value '.*?'(?= (?:is|has|does|must) )/gs, 'The value (valor omitido)')
    .replace(
      /(Element '[^']*'(?:, attribute '[^']*')?: )'.*?'(?= is not a valid value)/gs,
      '$1(valor omitido)',
    )
    .replace(/\d{11,}/g, '(valor omitido)');
}
