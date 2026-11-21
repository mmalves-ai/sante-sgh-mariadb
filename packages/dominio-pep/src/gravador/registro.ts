// Montagem do registro clínico (ficha do M22, seção 5, `pep.registrarEvolucao`): respostas → linhas de resposta,
// texto formatado do registro inteiro (texto do registro), formulário gravado (XML do formulário) e documento
// emitido (documento original da assinatura). A PROVA DO PRÓPRIO GRAVADOR: as linhas, relidas pelo
// leitor do M15, têm de bater com o formulário que o próprio novo produziu (a mesma conferência cruzada do leitor);
// faltou parte, o adaptador desfaz e avisa.
import type { RespostaRegistro } from '@sgh/contratos';
import type { ItemFormulario, RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import { conferirRegistro, type ResultadoConferencia } from '../prontuario/conferencia.js';
import { lerLayoutEpoca } from '../prontuario/formulario.js';
import { lerRespostas, type LinhaResposta, representacaoParaLeitura } from '../prontuario/respostas.js';
import { pareceRtf, rtfParaTexto } from '../prontuario/rtf.js';
import { type Apresentacao, type LinhaGravada, linhasDasRespostas } from './colunas.js';
import { type BlocoRegistro, rtfDoRegistro } from './rtf.js';
import {
  type CabecalhoDocumento,
  type CabecalhoFormulario,
  type ComponenteGravado,
  componentesDoRegistro,
  xmlDoDocumento,
  xmlDoFormulario,
} from './xml.js';

/** Blocos do texto do registro, com a numeração dos itens com resposta ("1 - SEÇÃO", "1.1 - Pergunta"). */
export function blocosDoRegistro(
  rep: Pick<RepresentacaoFormulario, 'itens'>,
  respondidos: ReadonlyMap<number, Apresentacao>,
  secoes: ReadonlySet<number>,
): BlocoRegistro[] {
  const blocos: BlocoRegistro[] = [];
  const visitar = (itens: readonly ItemFormulario[], prefixo: string) => {
    let n = 0;
    for (const i of itens) {
      const v = i['x-legacy'].vinculo;
      const ap = respondidos.get(v);
      const secao = secoes.has(v);
      if (!ap && !secao) continue;
      n++;
      const numero = prefixo ? `${prefixo}.${n}` : String(n);
      const rotulo = `${numero} - ${i.texto}`;
      if (secao && !ap) {
        blocos.push({ rotulo, nivel: prefixo ? 'pergunta' : 'secao', negrito: i.layout?.negrito === true });
        visitar(i.itens, numero);
      } else if (ap) {
        blocos.push(
          ap.linha !== null
            ? { rotulo, nivel: 'pergunta', negrito: false, naLinha: ap.linha }
            : { rotulo, nivel: 'pergunta', negrito: false, valor: ap.paragrafos ?? [] },
        );
      }
    }
  };
  visitar(rep.itens, '');
  return blocos;
}

export interface RegistroMontado {
  readonly linhas: readonly LinhaGravada[];
  readonly rtf: string;
  readonly componentes: readonly ComponenteGravado[];
  /** Formulário gravado (com o ID do registro, que só existe depois do INSERT do cabeçalho). */
  xml(registro: number): string;
  documento(registro: number, cab: CabecalhoDocumento): string;
}

export function montarRegistro(
  rep: Pick<RepresentacaoFormulario, 'itens' | 'modelo'>,
  respostas: readonly RespostaRegistro[],
  form: Omit<CabecalhoFormulario, 'registro'>,
  opcoes: { readonly exigirConfirmacao?: boolean } = {},
): RegistroMontado {
  const r = linhasDasRespostas(rep, respostas, opcoes);
  const auto = new Set(respostas.filter((x) => x.autopreenchido).map((x) => x.vinculo));
  const componentes = componentesDoRegistro(rep, r.respondidos, r.secoes, auto);
  return {
    linhas: r.linhas,
    rtf: rtfDoRegistro(blocosDoRegistro(rep, r.respondidos, r.secoes)),
    componentes,
    xml: (registro) => xmlDoFormulario({ ...form, registro }, componentes),
    documento: (registro, cab) => xmlDoDocumento(cab, { ...form, registro }, componentes),
  };
}

/** Linhas gravadas como o leitor do M15 as lê (o RTF decodificado é o próprio texto). */
export function comoLidas(
  linhas: readonly LinhaGravada[],
  cids: ReadonlyMap<string, string> = new Map(),
): LinhaResposta[] {
  return linhas.map((l) => ({
    ordem: l.ordem,
    seq: l.seq,
    idResposta: l.idResposta,
    data: l.data,
    hora: l.hora,
    indice: l.indice,
    valor: l.valor,
    alfa: l.alfa,
    texto: l.texto,
    unidade: l.unidade,
    cid: l.cid ? (cids.get(l.cid) ?? l.cid) : null,
    procedimento: null,
    observacao: null,
    autopreenchido: l.autopreenchido,
  }));
}

/**
 * Prova do gravador: as linhas (relidas) lidas pelo leitor do M15 × o formulário gravado (XML). Usada no
 * teste e na prova pós-escrita do adaptador (com as linhas relidas do banco).
 */
export function conferirGravado(
  rep: RepresentacaoFormulario,
  linhasLidas: readonly LinhaResposta[],
  xml: string,
): ResultadoConferencia {
  const leitura = representacaoParaLeitura(rep);
  const respostas = lerRespostas({
    linhas: linhasLidas,
    vinculos: leitura.vinculos,
    respostas: leitura.respostas,
    representacao: rep,
  });
  return conferirRegistro(lerLayoutEpoca(xml).campos, respostas.itens);
}

/** Texto do registro legível (prova: o RTF gravado é lido pelo leitor do M15 sem conteúdo ativo). */
export function rtfLegivel(rtf: string): boolean {
  if (!pareceRtf(rtf)) return false;
  const t = rtfParaTexto(rtf);
  return t.conteudoAtivoRemovido === 0 && t.paragrafos.length > 0;
}
