// A janela em produção do M58 por hospital (M58-F5; ficha, seções 5, 7, 8, 11 e 12) para a prontidão do desligamento:
// o roteiro de cada passo com os tempos dos ensaios da cópia (docs/marcos/M58/<h>/firebird5.json e utf8.json), a
// verificação depois da janela (docs/marcos/M58/<h>/janela.json, gravado por `pnpm janela:verificar`, na produção pela
// TI e na cópia como ensaio do roteiro) e a retirada da restrição de entrada (`entrada.utf8`). Lê só arquivos
// versionados; o charset do banco e o parâmetro vêm do chamador (porta). Ausente ou fora do esquema: nada verificado,
// com o aviso (falha fechada). Nada aqui liga coisa alguma: a chave liga pela tela "Funcionalidades por
// estabelecimento", que pergunta a `motivoLigarEntradaUtf8` antes (critério registrado pelo módulo de coexistência).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAVE_ENTRADA_UTF8,
  caminhoRelatorioJanela,
  type CharsetLegado,
  esquemaPainelJanela,
  esquemaRelatorioJanela,
  type MotivoRetiradaRestricao,
  type PainelJanela,
  PASSOS_DESLIGAMENTO,
  type RegistroDesligamento,
  type RelatorioJanela,
  type TemposEnsaioJanela,
} from '@sgh/contratos';
import {
  avaliarRetiradaRestricao,
  avaliarVerificacaoJanela,
  estimarJanelaDoRoteiro,
  estimarVoltaAtras,
  montarRoteiroJanela,
  verificacaoVigente,
} from '@sgh/dominio-config';
import { lerRelatorioEnsaioFirebird5 } from './ensaio-firebird5.js';
import { lerRelatorioEnsaioUtf8 } from './ensaio-utf8.js';

export interface RelatorioJanelaLido {
  readonly relatorio: RelatorioJanela | null;
  readonly invalido: string | null;
}

/** O relatório da verificação em `<raiz>/<h>/janela.json` (raiz: docs/marcos/M58, ou SGH_M58_ENSAIOS). */
export function lerRelatorioJanela(raiz: string | null, hospital: string): RelatorioJanelaLido {
  if (!raiz) return { relatorio: null, invalido: 'pasta dos ensaios não configurada' };
  const p = join(raiz, hospital, 'janela.json');
  if (!existsSync(p)) return { relatorio: null, invalido: 'nenhuma verificação registrada' };
  try {
    const r = esquemaRelatorioJanela.safeParse(JSON.parse(readFileSync(p, 'utf8')));
    if (!r.success)
      return {
        relatorio: null,
        invalido: `relatório fora do esquema: ${r.error.issues[0]?.message ?? 'inválido'}`,
      };
    if (r.data.estabelecimento !== hospital)
      return { relatorio: null, invalido: 'relatório de outro estabelecimento' };
    return { relatorio: r.data, invalido: null };
  } catch {
    return { relatorio: null, invalido: 'relatório ilegível' };
  }
}

const SEM_TEMPOS: TemposEnsaioJanela = {
  backupS: null,
  restauracaoS: null,
  integridadeS: null,
  voltaAtrasS: null,
  conversaoS: null,
  equivalenciaS: null,
  contagensS: null,
};

/** Os tempos medidos nos ensaios da F2 e da F3 (relatórios versionados); sem eles, o roteiro sai sem estimativa. */
export function temposDosEnsaios(raiz: string | null, hospital: string): TemposEnsaioJanela {
  if (!raiz) return SEM_TEMPOS;
  const f5 = lerRelatorioEnsaioFirebird5(raiz, hospital).relatorio?.etapas;
  const u8 = lerRelatorioEnsaioUtf8(raiz, hospital).relatorio?.etapas;
  return {
    backupS: f5?.backup.segundos ?? null,
    restauracaoS: f5?.restauracao.segundos ?? null,
    integridadeS: f5?.restauracao.verificacaoSegundos ?? null,
    voltaAtrasS: f5?.['volta-atras'].segundos ?? null,
    contagensS: f5?.contagens.segundos ?? null,
    conversaoS: u8?.conversao.segundos ?? null,
    equivalenciaS: u8?.equivalencia.segundos ?? null,
  };
}

export interface EntradaPainelJanela {
  readonly hospital: string;
  readonly em: Date;
  readonly raizEnsaios: string | null;
  readonly registro: RegistroDesligamento;
  readonly registroInvalido: string | null;
  readonly charsetBanco: string;
  readonly charsetParametro: CharsetLegado;
  readonly chaveLigada: boolean;
}

export function montarPainelJanela(e: EntradaPainelJanela): PainelJanela {
  const lido = lerRelatorioJanela(e.raizEnsaios, e.hospital);
  const verificacoes = lido.relatorio?.verificacoes ?? [];
  const tempos = temposDosEnsaios(e.raizEnsaios, e.hospital);
  const passos = PASSOS_DESLIGAMENTO.map((passo) => {
    const r = e.registro.passos[passo];
    const roteiro = montarRoteiroJanela(passo, e.hospital, tempos);
    const prod = verificacaoVigente(verificacoes, passo, 'producao');
    const ens = verificacaoVigente(verificacoes, passo, 'ensaio');
    return {
      passo,
      autorizado: r.autorizacao !== null,
      executado: r.execucao !== null,
      ensaioAprovado: r.ensaio?.resultado === 'aprovado',
      roteiro,
      janelaMinutos: estimarJanelaDoRoteiro(roteiro),
      voltaAtrasMinutos: estimarVoltaAtras(roteiro),
      producao: prod ? avaliarVerificacaoJanela(prod) : null,
      ensaio: ens ? avaliarVerificacaoJanela(ens) : null,
    };
  });
  const utf8 = passos.find((p) => p.passo === 'utf8');
  const retirada = avaliarRetiradaRestricao({
    registroValido: e.registroInvalido === null,
    utf8Autorizado: utf8?.autorizado ?? false,
    utf8Executado: utf8?.executado ?? false,
    verificacaoProducaoAprovada: utf8?.producao ? utf8.producao.aprovada : null,
    charsetBanco: e.charsetBanco,
    charsetParametro: e.charsetParametro,
    chaveLigada: e.chaveLigada,
  });
  return esquemaPainelJanela.parse({
    hospital: e.hospital,
    em: e.em.toISOString(),
    relatorio: caminhoRelatorioJanela(e.hospital),
    relatorioInvalido: lido.invalido,
    registroInvalido: e.registroInvalido,
    passos,
    retirada: {
      chave: CHAVE_ENTRADA_UTF8,
      ...retirada,
      charsetBanco: e.charsetBanco,
      charsetParametro: e.charsetParametro,
    },
  });
}

/** Os motivos em frase para a recusa de ligar a chave (409 na tela de funcionalidades; sem chave técnica no texto). */
const FRASE_MOTIVO: Record<MotivoRetiradaRestricao, string> = {
  'registro-invalido': 'o registro dos passos do desligamento não pôde ser lido',
  'utf8-nao-autorizado': 'a conversão para UTF-8 não tem a autorização do dono registrada',
  'utf8-nao-executado': 'a conversão para UTF-8 ainda não foi executada na janela',
  'verificacao-ausente': 'a verificação depois da janela da conversão não foi registrada',
  'verificacao-reprovada': 'a verificação depois da janela da conversão foi reprovada',
  'banco-nao-utf8': 'o banco do estabelecimento ainda não está em UTF-8',
  'parametro-nao-utf8': 'o parâmetro do charset do estabelecimento ainda não diz UTF-8',
};

export function fraseRetirada(motivos: readonly MotivoRetiradaRestricao[]): string | null {
  if (motivos.length === 0) return null;
  return `A entrada sem restrição de caracteres só liga depois da conversão verificada: ${motivos
    .map((m) => FRASE_MOTIVO[m])
    .join('; ')}.`;
}
