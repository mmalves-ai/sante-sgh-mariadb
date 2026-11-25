// Catálogo das visões exportáveis aos parceiros e a montagem do arquivo do pacote (F3.9, linha 08-INTG L134).
//   - O pacote só leva campo que existe no catálogo (lista branca): entidade e campo são conferidos na hora do cadastro,
//     com o campo sensível (LGPD art. 5 II e 11) marcado como tal e o identificador tratado no pacote pseudonimizado,
//     anonimizado ou agregado (minimização, art. 6 III; segurança, art. 46).
//   - A montagem aplica o tratamento de cada campo (pseudônimo HMAC por parceiro, máscara, generalização, agregação) e
//     gera o conteúdo no formato do pacote (CSV, JSON, XML ou FHIR R4), com o hash SHA-256 do que sai.
//   - O transporte decide o que acontece com a entrega gerada: fora de produção é SEMPRE simulado (nada sai da máquina);
//     em produção, API e webhook vão por HTTP ao ponto de integração; os outros meios ficam para o operador enviar.
// Tudo puro: o worker lê as linhas e grava; o domínio decide.
import { createHash, createHmac } from 'node:crypto';
import type {
  Anonimizacao,
  ErroPacote,
  FormatoPacote,
  MeioEntrega,
  PeriodicidadePacote,
  TratamentoCampo,
} from './pacotes-entregas.js';

export type TipoCampoVisao = 'texto' | 'codigo' | 'numero' | 'data' | 'data_hora';

export interface CampoVisao {
  readonly nome: string;
  readonly rotulo: string;
  readonly tipo: TipoCampoVisao;
  /** Dado pessoal sensível (saúde): o pacote tem de marcá-lo e, fora do pacote sem anonimização, tratá-lo. */
  readonly sensivel: boolean;
  /** Identifica a pessoa (direta ou indiretamente): nunca sai original em pacote pseudonimizado, anonimizado ou agregado. */
  readonly identificador: boolean;
}

export interface VisaoExportavel {
  readonly entidade: string;
  readonly rotulo: string;
  /** O recorte do período: o que entra numa entrega. */
  readonly recorte: string;
  readonly campos: readonly CampoVisao[];
}

const c = (
  nome: string,
  rotulo: string,
  tipo: TipoCampoVisao,
  x: { sensivel?: boolean; identificador?: boolean } = {},
): CampoVisao => ({ nome, rotulo, tipo, sensivel: !!x.sensivel, identificador: !!x.identificador });

/** A lista branca: o que um pacote pode levar. O worker tem a leitura de cada campo (conferida em teste). */
export const VISOES_EXPORTAVEIS: readonly VisaoExportavel[] = [
  {
    entidade: 'atendimento',
    rotulo: 'Atendimentos',
    recorte: 'Atendimentos com entrada no período',
    campos: [
      c('numero', 'Número do atendimento', 'codigo', { identificador: true }),
      c('estabelecimento', 'Estabelecimento', 'codigo'),
      c('prontuario', 'Prontuário do paciente', 'codigo', { identificador: true }),
      c('nascimento', 'Data de nascimento', 'data', { identificador: true }),
      c('entrada', 'Entrada', 'data_hora'),
      c('saida', 'Saída', 'data_hora'),
      c('situacao', 'Situação', 'texto'),
      c('desfecho', 'Desfecho', 'texto'),
      c('cid_principal', 'CID principal', 'codigo', { sensivel: true }),
    ],
  },
  {
    entidade: 'internacao',
    rotulo: 'Internações',
    recorte: 'Internações com entrada no período',
    campos: [
      c('numero', 'Número da internação', 'codigo', { identificador: true }),
      c('estabelecimento', 'Estabelecimento', 'codigo'),
      c('prontuario', 'Prontuário do paciente', 'codigo', { identificador: true }),
      c('nome', 'Nome do paciente', 'texto', { identificador: true }),
      c('nascimento', 'Data de nascimento', 'data', { identificador: true }),
      c('entrada', 'Entrada', 'data_hora'),
      c('saida', 'Alta', 'data_hora'),
      c('leito', 'Leito', 'codigo'),
      c('situacao', 'Situação', 'texto'),
      c('diarias_previstas', 'Diárias previstas', 'numero'),
      c('cid_principal', 'CID principal', 'codigo', { sensivel: true }),
    ],
  },
];

export function visaoExportavel(entidade: string): VisaoExportavel | null {
  return VISOES_EXPORTAVEIS.find((v) => v.entidade === entidade) ?? null;
}

export function campoDaVisao(entidade: string, campo: string): CampoVisao | null {
  return visaoExportavel(entidade)?.campos.find((k) => k.nome === campo) ?? null;
}

const erro = (campo: string, codigo: string, mensagem: string): ErroPacote => ({ campo, codigo, mensagem });

/** Formatos que o sistema gera sozinho (a entrega agendada precisa de um deles). */
export const FORMATOS_GERADOS: readonly FormatoPacote[] = ['csv', 'json', 'xml', 'fhir'];

/** O tratamento serve ao tipo do campo? (generalizar texto livre ou mascarar data não protege nada.) */
export function tratamentoServe(t: TratamentoCampo, tipo: TipoCampoVisao): boolean {
  if (t === 'generalizado') return tipo !== 'texto';
  if (t === 'mascarado') return tipo === 'codigo' || tipo === 'texto';
  return true;
}

/**
 * Conferência do pacote contra o catálogo (vazio = aceito): entidade e campo existem; uma visão por pacote (um arquivo
 * é uma tabela); o sensível do catálogo vem marcado; o identificador não sai original fora do pacote sem anonimização;
 * o anonimizado não leva pseudônimo (pseudônimo é religável); o tratamento serve ao tipo; agregado só em pacote
 * agregado; a entrega agendada só em formato que o sistema gera.
 */
export function conferirPacoteNoCatalogo(
  p: {
    readonly formato: FormatoPacote;
    readonly periodicidade: PeriodicidadePacote;
    readonly anonimizacao: Anonimizacao;
  },
  campos: readonly {
    readonly entidade: string;
    readonly campo: string;
    readonly tratamento: TratamentoCampo;
    readonly dadoSensivel: boolean;
  }[],
): ErroPacote[] {
  const e: ErroPacote[] = [];
  if (p.periodicidade !== 'sob_demanda' && !FORMATOS_GERADOS.includes(p.formato))
    e.push(
      erro(
        'formato',
        'formato-sem-geracao',
        `A entrega agendada sai em ${FORMATOS_GERADOS.join(', ')}; ${p.formato} só sob demanda.`,
      ),
    );
  const entidades = new Set(campos.map((k) => k.entidade));
  if (entidades.size > 1)
    e.push(erro('campos', 'visoes-misturadas', 'Um pacote lê uma visão só: separe em dois pacotes.'));
  campos.forEach((k, i) => {
    const visao = visaoExportavel(k.entidade);
    if (!visao) {
      e.push(
        erro(`campos.${i}.entidade`, 'entidade-fora-do-catalogo', `A visão ${k.entidade} não é exportável.`),
      );
      return;
    }
    const v = visao.campos.find((x) => x.nome === k.campo);
    if (!v) {
      e.push(
        erro(
          `campos.${i}.campo`,
          'campo-fora-do-catalogo',
          `O campo ${k.campo} não está na visão ${visao.rotulo}.`,
        ),
      );
      return;
    }
    if (v.sensivel && !k.dadoSensivel)
      e.push(
        erro(
          `campos.${i}.dadoSensivel`,
          'sensivel-nao-marcado',
          `${v.rotulo} é dado sensível: marque-o como tal.`,
        ),
      );
    if (v.identificador && k.tratamento === 'original' && p.anonimizacao !== 'nenhuma')
      e.push(
        erro(
          `campos.${i}.tratamento`,
          'identificador-sem-tratamento',
          `O pacote é ${p.anonimizacao}: ${v.rotulo} identifica a pessoa e não pode sair original.`,
        ),
      );
    if (p.anonimizacao === 'anonimizada' && k.tratamento === 'pseudonimizado')
      e.push(
        erro(
          `campos.${i}.tratamento`,
          'anonimizada-com-pseudonimo',
          `Pacote anonimizado não leva pseudônimo (${v.rotulo}): generalize, mascare ou tire o campo.`,
        ),
      );
    if (!tratamentoServe(k.tratamento, v.tipo))
      e.push(
        erro(
          `campos.${i}.tratamento`,
          'tratamento-nao-serve',
          `${v.rotulo} (${v.tipo}) não aceita o tratamento ${k.tratamento}.`,
        ),
      );
    if (k.tratamento === 'agregado' && p.anonimizacao !== 'agregada')
      e.push(
        erro(`campos.${i}.tratamento`, 'agregado-fora-do-agregado', 'Campo agregado só em pacote agregado.'),
      );
  });
  return e;
}

// ── Tratamento dos valores ──

export interface ContextoTratamento {
  /** Chave do pseudônimo (mínimo de 16 bytes), da configuração do ambiente; nunca vai ao arquivo nem ao log. */
  readonly chave: string | null;
  /** Escopo do pseudônimo: o parceiro (o mesmo paciente tem pseudônimos diferentes em parceiros diferentes). */
  readonly escopo: string;
}

const doisDig = (n: number) => String(n).padStart(2, '0');
function comoData(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** O valor original na forma do arquivo: data AAAA-MM-DD, data e hora ISO 8601 em UTC, número como número. */
export function valorOriginal(v: unknown, tipo: TipoCampoVisao): string | number | null {
  if (v === null || v === undefined || v === '') return null;
  if (tipo === 'data' || tipo === 'data_hora') {
    const d = comoData(v);
    if (!d) return null;
    return tipo === 'data' ? d.toISOString().slice(0, 10) : d.toISOString();
  }
  if (tipo === 'numero') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return String(v);
}

/** Pseudônimo HMAC-SHA-256 (20 hexadecimais) com o escopo do parceiro e o campo no texto. */
export function pseudonimoDoCampo(chave: string, escopo: string, campo: string, valor: string): string {
  if (Buffer.byteLength(chave) < 16)
    throw new Error('Chave do pseudônimo curta demais (mínimo de 16 bytes).');
  return createHmac('sha256', chave).update(`${escopo}:${campo}:${valor}`).digest('hex').slice(0, 20);
}

/** Aplica o tratamento do campo ao valor (o agregado é tratado na montagem, sobre o grupo). */
export function tratarValor(
  v: unknown,
  campo: { readonly campo: string; readonly tratamento: TratamentoCampo },
  tipo: TipoCampoVisao,
  ctx: ContextoTratamento,
): string | number | null {
  const o = valorOriginal(v, tipo);
  if (o === null) return null;
  switch (campo.tratamento) {
    case 'original':
    case 'agregado':
      return o;
    case 'pseudonimizado':
      if (!ctx.chave) throw new Error('Pacote com pseudônimo sem a chave configurada.');
      return pseudonimoDoCampo(ctx.chave, ctx.escopo, campo.campo, String(o));
    case 'mascarado': {
      const s = String(o);
      return s.length <= 4 ? '*'.repeat(s.length) : '*'.repeat(s.length - 4) + s.slice(-4);
    }
    case 'generalizado': {
      if (tipo === 'data' || tipo === 'data_hora') {
        const d = comoData(v)!;
        return `${d.getUTCFullYear()}-${doisDig(d.getUTCMonth() + 1)}`;
      }
      if (tipo === 'numero') {
        const base = Math.floor(Number(o) / 10) * 10;
        return `${base}-${base + 9}`;
      }
      // Código: a categoria (CID "I21.0" vira "I21"; o resto, os 3 primeiros caracteres).
      return String(o)
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 3);
    }
  }
}

export interface CampoMontagem {
  readonly sequencia: number;
  readonly entidade: string;
  readonly campo: string;
  readonly rotuloSaida: string;
  readonly tratamento: TratamentoCampo;
}

export interface CabecalhoArquivo {
  readonly pacote: string;
  readonly periodoInicio: Date;
  readonly periodoFim: Date;
  readonly geradoEm: Date;
}

export type ArquivoMontado =
  | {
      readonly ok: true;
      readonly conteudo: string;
      readonly tipoMime: string;
      readonly extensao: string;
      readonly quantidadeRegistros: number;
      readonly tamanhoBytes: number;
      readonly hashSha256: string;
    }
  | { readonly ok: false; readonly erros: ErroPacote[] };

/** As linhas tratadas (na ordem da sequência); no pacote agregado, agrupadas com a contagem. */
export function linhasTratadas(
  campos: readonly CampoMontagem[],
  linhas: readonly Record<string, unknown>[],
  anonimizacao: Anonimizacao,
  ctx: ContextoTratamento,
): { rotulos: string[]; registros: (string | number | null)[][] } {
  const ord = [...campos].sort((a, b) => a.sequencia - b.sequencia);
  const tipos = ord.map((k) => campoDaVisao(k.entidade, k.campo)?.tipo ?? 'texto');
  const tratadas = linhas.map((l) => ord.map((k, i) => tratarValor(l[k.campo], k, tipos[i]!, ctx)));
  const rotulos = ord.map((k) => k.rotuloSaida);
  if (anonimizacao !== 'agregada') return { rotulos, registros: tratadas };
  // Agregado: agrupa pelos campos não agregados; o campo agregado conta os preenchidos; "quantidade" conta as linhas.
  const chaveIdx = ord.map((k, i) => (k.tratamento === 'agregado' ? -1 : i)).filter((i) => i >= 0);
  const grupos = new Map<string, (string | number | null)[]>();
  for (const t of tratadas) {
    const chave = JSON.stringify(chaveIdx.map((i) => t[i]));
    let g = grupos.get(chave);
    if (!g) {
      g = ord.map((k, i) => (k.tratamento === 'agregado' ? 0 : t[i]!));
      g.push(0);
      grupos.set(chave, g);
    }
    ord.forEach((k, i) => {
      if (k.tratamento === 'agregado' && t[i] !== null) g[i] = Number(g[i]) + 1;
    });
    g[ord.length] = Number(g[ord.length]) + 1;
  }
  const registros = [...grupos.values()].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return { rotulos: [...rotulos, 'quantidade'], registros };
}

const csvCelula = (v: string | number | null) => {
  if (v === null) return '';
  const s = String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const xmlTexto = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sha256Texto(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Monta o arquivo do pacote no formato dele, com os campos tratados, o volume e o hash do que sai. */
export function montarArquivoPacote(e: {
  readonly formato: FormatoPacote;
  readonly anonimizacao: Anonimizacao;
  readonly campos: readonly CampoMontagem[];
  readonly linhas: readonly Record<string, unknown>[];
  readonly cabecalho: CabecalhoArquivo;
  readonly tratamento: ContextoTratamento;
}): ArquivoMontado {
  const erros: ErroPacote[] = [];
  if (!FORMATOS_GERADOS.includes(e.formato))
    erros.push(erro('formato', 'formato-sem-geracao', `O sistema não gera ${e.formato} sozinho.`));
  if (!e.campos.length) erros.push(erro('campos', 'sem-campos', 'O pacote não tem campos.'));
  if (e.campos.some((k) => k.tratamento === 'pseudonimizado') && (e.tratamento.chave ?? '').length < 16)
    erros.push(erro('chave', 'sem-chave-pseudonimo', 'A chave do pseudônimo não está configurada.'));
  for (const k of e.campos)
    if (!campoDaVisao(k.entidade, k.campo))
      erros.push(
        erro('campos', 'campo-fora-do-catalogo', `O campo ${k.entidade}.${k.campo} não é exportável.`),
      );
  if (erros.length) return { ok: false, erros };
  const { rotulos, registros } = linhasTratadas(e.campos, e.linhas, e.anonimizacao, e.tratamento);
  const cab = e.cabecalho;
  let conteudo: string;
  let tipoMime: string;
  let extensao: string;
  if (e.formato === 'csv') {
    conteudo = [rotulos, ...registros].map((r) => r.map(csvCelula).join(';')).join('\r\n') + '\r\n';
    tipoMime = 'text/csv';
    extensao = 'csv';
  } else if (e.formato === 'json') {
    conteudo = JSON.stringify({
      pacote: cab.pacote,
      periodoInicio: cab.periodoInicio.toISOString(),
      periodoFim: cab.periodoFim.toISOString(),
      geradoEm: cab.geradoEm.toISOString(),
      registros: registros.map((r) => Object.fromEntries(rotulos.map((n, i) => [n, r[i] ?? null]))),
    });
    tipoMime = 'application/json';
    extensao = 'json';
  } else if (e.formato === 'xml') {
    const regs = registros
      .map(
        (r) =>
          `<registro>${rotulos
            .map((n, i) =>
              r[i] === null ? '' : `<campo nome="${xmlTexto(n)}">${xmlTexto(String(r[i]))}</campo>`,
            )
            .join('')}</registro>`,
      )
      .join('');
    conteudo =
      `<?xml version="1.0" encoding="UTF-8"?>\n<pacote codigo="${xmlTexto(cab.pacote)}" inicio="${cab.periodoInicio.toISOString()}"` +
      ` fim="${cab.periodoFim.toISOString()}" gerado="${cab.geradoEm.toISOString()}">${regs}</pacote>\n`;
    tipoMime = 'application/xml';
    extensao = 'xml';
  } else {
    // FHIR R4: Bundle do tipo collection; cada registro é um Basic com uma extensão por campo.
    const entidade = e.campos[0]!.entidade;
    conteudo = JSON.stringify({
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: cab.geradoEm.toISOString(),
      meta: { tag: [{ system: 'urn:sgh:pacote', code: cab.pacote }] },
      entry: registros.map((r) => ({
        resource: {
          resourceType: 'Basic',
          code: { text: entidade },
          extension: rotulos
            .map((n, i) =>
              r[i] === null
                ? null
                : typeof r[i] === 'number'
                  ? { url: `urn:sgh:pacote:${n}`, valueDecimal: r[i] }
                  : { url: `urn:sgh:pacote:${n}`, valueString: String(r[i]) },
            )
            .filter((x) => x !== null),
        },
      })),
    });
    tipoMime = 'application/fhir+json';
    extensao = 'json';
  }
  return {
    ok: true,
    conteudo,
    tipoMime,
    extensao,
    quantidadeRegistros: registros.length,
    tamanhoBytes: Buffer.byteLength(conteudo, 'utf8'),
    hashSha256: sha256Texto(conteudo),
  };
}

// ── Transporte ──

export type TransporteEntrega =
  /** Fora de produção: nada sai; a entrega anda para confirmada com protocolo simulado. */
  | { readonly modo: 'simulado' }
  /** Produção, API ou webhook: POST ao endereço do ponto de integração do pacote. */
  | { readonly modo: 'http' }
  /** Produção, meio sem envio automático (SFTP, arquivo seguro, e-mail seguro): o operador baixa e marca enviada. */
  | { readonly modo: 'operador' };

export function transporteDaEntrega(meio: MeioEntrega, ambiente: string): TransporteEntrega {
  if (ambiente !== 'producao') return { modo: 'simulado' };
  return meio === 'api' || meio === 'webhook' ? { modo: 'http' } : { modo: 'operador' };
}

/** O protocolo simulado (fora de produção): marca que nada saiu. */
export const protocoloSimulado = (entrega: number) => `SIMULADO-${entrega}`;
