// Registro-resumo do formulário novo (M45, etapa 1; ficha seção 5, "Contorno enquanto não for liberada"): enquanto
// `pep.publicarFormularioNovo` não estiver liberada, o formulário novo grava as respostas em SGH_PEP_FORMNOVO_RESP e
// um registro-resumo pelo `pep.registrarEvolucao` num modelo de texto já verde (DP-27), com o conteúdo renderizado
// no texto formatado. Aqui só os blocos do resumo (numeração "1 - SEÇÃO", "1.2 - Pergunta: valor"), na mesma forma
// do gravador do M22 (`rtfDoRegistro`). Só as perguntas habilitadas e respondidas; calculadas com o valor calculado.
import type {
  DefinicaoFormularioNovo,
  PerguntaFormularioNovo,
  ValorCasoFormularioNovo,
} from '@sgh/contratos';
import { type BlocoRegistro, paragrafosDoTexto, rtfDoRegistro } from '../gravador/rtf.js';
import { numeroFormulario } from '../gravador/colunas.js';
import type { Valor } from '../regras/valores.js';
import { avaliarFormularioNovo } from './avaliacao.js';

const vazio = (v: ValorCasoFormularioNovo | undefined) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function textoDoValor(p: PerguntaFormularioNovo, v: ValorCasoFormularioNovo | Valor): string {
  const comUnidade = (s: string) => (p.unidade?.trim() ? `${s} ${p.unidade.trim()}` : s);
  if (typeof v === 'number') return comUnidade(numeroFormulario(v));
  if (p.tipo === 'escolha' || p.tipo === 'escolha-com-texto')
    return p.opcoes.find((o) => o.codigo === v)?.texto ?? String(v);
  if (p.tipo === 'data' && typeof v === 'string') {
    const [a, m, d] = v.split('-');
    return `${d}/${m}/${a}`;
  }
  return comUnidade(String(v ?? ''));
}

/** Blocos do resumo, na ordem da definição; seções só quando têm algo respondido abaixo. */
export function blocosDoResumo(
  def: DefinicaoFormularioNovo,
  respostas: Readonly<Record<string, ValorCasoFormularioNovo>>,
  hoje: string,
): BlocoRegistro[] {
  const estado = avaliarFormularioNovo(def, respostas, hoje);
  const blocos: BlocoRegistro[] = [];
  const respondida = (p: PerguntaFormularioNovo): boolean =>
    p.tipo === 'secao'
      ? p.itens.some(respondida)
      : estado.habilitadas.has(p.linkId) &&
        (p.calcular !== null ? estado.valores[p.linkId] != null : !vazio(respostas[p.linkId]));
  const visitar = (ps: readonly PerguntaFormularioNovo[], prefixo: string) => {
    let n = 0;
    for (const p of ps) {
      if (!respondida(p)) continue;
      n += 1;
      const num = prefixo ? `${prefixo}.${n}` : String(n);
      if (p.tipo === 'secao') {
        blocos.push({ rotulo: `${num} - ${p.titulo.toUpperCase()}`, nivel: 'secao', negrito: true });
        visitar(p.itens, num);
        continue;
      }
      const rotulo = `${num} - ${p.titulo}`;
      const v = p.calcular !== null ? (estado.valores[p.linkId] ?? null) : respostas[p.linkId]!;
      if (p.tipo === 'multipla' && Array.isArray(v)) {
        const textos = v.map((c) => p.opcoes.find((o) => o.codigo === c)?.texto ?? c);
        blocos.push({
          rotulo,
          nivel: 'pergunta',
          negrito: false,
          valor: paragrafosDoTexto(textos.join('\n')),
        });
      } else if (p.tipo === 'texto-formatado' && typeof v === 'string') {
        blocos.push({ rotulo, nivel: 'pergunta', negrito: false, valor: paragrafosDoTexto(v) });
      } else {
        blocos.push({ rotulo, nivel: 'pergunta', negrito: false, naLinha: textoDoValor(p, v as Valor) });
      }
    }
  };
  visitar(def.perguntas, '');
  return blocos;
}

/** Texto formatado do registro-resumo (título do formulário, versão e as respostas). */
export function rtfDoResumo(
  def: DefinicaoFormularioNovo,
  versao: number,
  respostas: Readonly<Record<string, ValorCasoFormularioNovo>>,
  hoje: string,
): string {
  const cabecalho: BlocoRegistro = {
    rotulo: `${def.titulo} (versão ${versao})`,
    nivel: 'secao',
    negrito: true,
  };
  return rtfDoRegistro([cabecalho, ...blocosDoResumo(def, respostas, hoje)]);
}

/**
 * O mesmo resumo em texto simples (uma linha por bloco: "1 - SEÇÃO", "1.1 - Pergunta: valor"), para a resposta de
 * texto formatado do modelo de texto do registro-resumo (o gravador do M22 monta o texto formatado dele).
 */
export function textoDoResumo(
  def: DefinicaoFormularioNovo,
  versao: number,
  respostas: Readonly<Record<string, ValorCasoFormularioNovo>>,
  hoje: string,
): string {
  const linhas = [`${def.titulo} (versão ${versao})`];
  for (const b of blocosDoResumo(def, respostas, hoje)) {
    if (b.naLinha !== undefined) linhas.push(`${b.rotulo}: ${b.naLinha}`);
    else linhas.push(b.rotulo);
    for (const p of b.valor ?? []) linhas.push(`    ${p.trechos.map((t) => t.texto).join('')}`);
  }
  return linhas.join('\n');
}
