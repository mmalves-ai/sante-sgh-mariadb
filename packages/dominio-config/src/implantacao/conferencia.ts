// M60, etapa 2: regras puras da conferência da instalação (ficha do M60, campo 2, M60-F2 "Conexão ao banco" e regras
// 5 e 6). Recebem o que a leitura do banco e o pacote instalado disseram e devolvem os itens com a situação:
// - "falha" barra a liberação (em produção, conta SYSDBA, canal sem cifra, autenticação antiga, papel errado, script
//   divergente ou pendente, charset desencontrado, versão diferente da esperada);
// - "alerta" pede atenção sem barrar (as mesmas condições fora de produção, motor fora dos homologados, scripts que o
//   pacote não conhece);
// - "ok" confere.
// Nenhum texto cita senha, endereço ou pessoa: só nomes técnicos e contagens.
import {
  AUTENTICACOES_ACEITAS,
  type CharsetLegado,
  type ConexaoConferida,
  type ItemConferencia,
  type ScriptsConferidos,
  type SituacaoItemConferencia,
} from '@sgh/contratos';
import { charsetConfere, versaoMaior } from '../desligamento/plataforma.js';

/** Motores homologados: o Firebird 3 de hoje e o 5 da troca do M58. */
export const VERSOES_MAIORES_HOMOLOGADAS: readonly number[] = [3, 5];
/** O papel que a conta da aplicação usa (criado no script 0001). */
export const PAPEL_APLICACAO = 'SGH_APLICACAO';
/** Quantos números de scripts pendentes a conferência lista (o total vem à parte). */
export const TETO_PENDENTES_LISTADOS = 20;

export interface ScriptDoPacote {
  readonly numero: number;
  readonly hash: string;
}

const n4 = (n: number): string => String(n).padStart(4, '0');

/**
 * Scripts do pacote contra os registrados no banco (SGH_VERSAO_SCRIPT). `aplicados` nulo: o registro não pôde ser lido
 * (a conta sem o papel); sai `registroLido: false`, sem pendentes nem divergentes inventados.
 */
export function conferirScripts(
  pacote: readonly ScriptDoPacote[],
  aplicados: readonly ScriptDoPacote[] | null,
): ScriptsConferidos {
  if (aplicados === null) {
    const nums = pacote.map((p) => p.numero);
    return {
      registroLido: false,
      noPacote: new Set(nums).size,
      ultimoNoPacote: nums.length === 0 ? null : n4(Math.max(...nums)),
      aplicados: 0,
      ultimoAplicado: null,
      pendentes: [],
      pendentesTotal: 0,
      divergentes: [],
      desconhecidos: [],
    };
  }
  const noBanco = new Map(aplicados.map((a) => [a.numero, a.hash.trim().toLowerCase()]));
  const doPacote = new Map(pacote.map((p) => [p.numero, p.hash.trim().toLowerCase()]));
  const ordem = (a: number, b: number) => a - b;
  const pendentes = [...doPacote.keys()].filter((k) => !noBanco.has(k)).sort(ordem);
  const divergentes = [...doPacote.entries()]
    .filter(([k, h]) => noBanco.has(k) && noBanco.get(k) !== h)
    .map(([k]) => k)
    .sort(ordem);
  const desconhecidos = [...noBanco.keys()].filter((k) => !doPacote.has(k)).sort(ordem);
  const maior = (xs: Iterable<number>): string | null => {
    const v = [...xs];
    return v.length === 0 ? null : n4(Math.max(...v));
  };
  return {
    registroLido: true,
    noPacote: doPacote.size,
    ultimoNoPacote: maior(doPacote.keys()),
    aplicados: noBanco.size,
    ultimoAplicado: maior(noBanco.keys()),
    pendentes: pendentes.slice(0, TETO_PENDENTES_LISTADOS).map(n4),
    pendentesTotal: pendentes.length,
    divergentes: divergentes.map(n4),
    desconhecidos: desconhecidos.map(n4),
  };
}

export interface EntradaConferenciaInstalacao {
  readonly ambiente: string;
  readonly conexao: ConexaoConferida;
  readonly scripts: ScriptsConferidos;
  readonly charsetParametro: CharsetLegado;
  /** Identificação da versão instalada (GET /api/versao). */
  readonly identificacao: string;
  /** A identificação que o pacote promete (SONDA_VERSAO_ESPERADA); ausente: só mostra a instalada. */
  readonly identificacaoEsperada?: string | null;
}

const item = (
  codigo: ItemConferencia['codigo'],
  titulo: string,
  situacao: SituacaoItemConferencia,
  detalhe: string,
): ItemConferencia => ({ codigo, titulo, situacao, detalhe });

/** Em produção o que é só alerta nos outros ambientes vira falha. */
const grave = (ambiente: string): SituacaoItemConferencia => (ambiente === 'producao' ? 'falha' : 'alerta');

function itemMotor(versao: string): ItemConferencia {
  const titulo = 'Versão do motor do banco';
  let maior: number;
  try {
    maior = versaoMaior(versao);
  } catch {
    return item('motor', titulo, 'falha', 'A versão do motor não foi reconhecida.');
  }
  return VERSOES_MAIORES_HOMOLOGADAS.includes(maior)
    ? item('motor', titulo, 'ok', `Firebird ${versao}.`)
    : item('motor', titulo, 'alerta', `Firebird ${versao}: versão não homologada para o produto.`);
}

function itemAutenticacao(e: EntradaConferenciaInstalacao): ItemConferencia {
  const titulo = 'Autenticação da conexão';
  const a = e.conexao.autenticacao;
  if (a !== null && (AUTENTICACOES_ACEITAS as readonly string[]).includes(a))
    return item('autenticacao', titulo, 'ok', `Autenticação ${a}.`);
  if (a === null)
    return item('autenticacao', titulo, grave(e.ambiente), 'O banco não informou o método de autenticação.');
  return item(
    'autenticacao',
    titulo,
    grave(e.ambiente),
    `Autenticação ${a}: use Srp (AuthClient = Srp256, Srp no cliente do banco do servidor de aplicação).`,
  );
}

function itemCanal(e: EntradaConferenciaInstalacao): ItemConferencia {
  const titulo = 'Canal cifrado entre o servidor e o banco';
  const c = e.conexao.canalCifrado;
  if (c === true) return item('canal-cifrado', titulo, 'ok', 'O canal com o banco está cifrado.');
  return item(
    'canal-cifrado',
    titulo,
    grave(e.ambiente),
    c === null
      ? 'O banco não informou se o canal está cifrado.'
      : 'O canal com o banco não está cifrado: use WireCrypt = Required no cliente e no servidor do banco.',
  );
}

function itemCharset(e: EntradaConferenciaInstalacao): ItemConferencia {
  const titulo = 'Codificação do texto';
  const { charsetBanco } = e.conexao;
  return charsetConfere(charsetBanco, e.charsetParametro)
    ? item('charset', titulo, 'ok', `Banco ${charsetBanco}, parâmetro da codificação ${e.charsetParametro}.`)
    : item(
        'charset',
        titulo,
        'falha',
        `Banco ${charsetBanco} e parâmetro da codificação ${e.charsetParametro} não casam: o texto seria gravado com a codificação errada.`,
      );
}

function itemConta(e: EntradaConferenciaInstalacao): ItemConferencia {
  const titulo = 'Conta própria da aplicação';
  if (e.conexao.conta.trim().toUpperCase() !== 'SYSDBA')
    return item('conta-propria', titulo, 'ok', `Conta técnica ${e.conexao.conta}.`);
  return item(
    'conta-propria',
    titulo,
    grave(e.ambiente),
    'A aplicação está conectada como SYSDBA: crie a conta própria da aplicação e configure-a no arquivo de ambiente.',
  );
}

function itemPapel(e: EntradaConferenciaInstalacao): ItemConferencia {
  const titulo = 'Papel da aplicação';
  const p = e.conexao.papel?.trim().toUpperCase() ?? '';
  if (p === PAPEL_APLICACAO) return item('papel-aplicacao', titulo, 'ok', `Papel ${PAPEL_APLICACAO} em uso.`);
  return item(
    'papel-aplicacao',
    titulo,
    grave(e.ambiente),
    `A conexão não usa o papel ${PAPEL_APLICACAO}: conceda o papel à conta da aplicação (seção 6 do manual).`,
  );
}

function itemScripts(e: EntradaConferenciaInstalacao): ItemConferencia {
  const titulo = 'Objetos do produto no banco';
  const s = e.scripts;
  if (!s.registroLido)
    return item(
      'scripts',
      titulo,
      'falha',
      `A conta da aplicação não lê o registro dos scripts do produto: conceda o papel ${PAPEL_APLICACAO} à conta da aplicação (seção 6 do manual).`,
    );
  if (s.divergentes.length > 0)
    return item(
      'scripts',
      titulo,
      'falha',
      `${s.divergentes.length} script(s) aplicados com conteúdo diferente do pacote (${s.divergentes.join(', ')}).`,
    );
  if (s.pendentesTotal > 0)
    return item(
      'scripts',
      titulo,
      'falha',
      `${s.pendentesTotal} script(s) do pacote ainda não aplicados (a partir de ${s.pendentes[0]}): rode a migração.`,
    );
  if (s.desconhecidos.length > 0)
    return item(
      'scripts',
      titulo,
      'alerta',
      `Todos os ${s.noPacote} scripts do pacote aplicados; o banco tem ${s.desconhecidos.length} script(s) de uma versão mais nova.`,
    );
  return item(
    'scripts',
    titulo,
    'ok',
    `Os ${s.noPacote} scripts do pacote aplicados, até o ${s.ultimoNoPacote ?? '—'}.`,
  );
}

function itemVersao(e: EntradaConferenciaInstalacao): ItemConferencia {
  const titulo = 'Versão instalada';
  const esperada = e.identificacaoEsperada?.trim() ?? '';
  if (esperada === '') return item('versao', titulo, 'ok', `Versão ${e.identificacao}.`);
  return esperada === e.identificacao
    ? item('versao', titulo, 'ok', `Versão ${e.identificacao}, a esperada pelo pacote.`)
    : item(
        'versao',
        titulo,
        'falha',
        `Versão ${e.identificacao} instalada, mas o pacote espera ${esperada}: refaça a atualização.`,
      );
}

/** Os itens da conferência, na ordem de ITENS_CONFERENCIA_INSTALACAO. */
export function itensDaConferencia(e: EntradaConferenciaInstalacao): ItemConferencia[] {
  return [
    itemMotor(e.conexao.versaoMotor),
    itemAutenticacao(e),
    itemCanal(e),
    itemCharset(e),
    itemConta(e),
    itemPapel(e),
    itemScripts(e),
    itemVersao(e),
  ];
}

/** A pior situação dos itens. */
export function situacaoDaConferencia(itens: readonly ItemConferencia[]): SituacaoItemConferencia {
  if (itens.some((i) => i.situacao === 'falha')) return 'falha';
  if (itens.some((i) => i.situacao === 'alerta')) return 'alerta';
  return 'ok';
}
