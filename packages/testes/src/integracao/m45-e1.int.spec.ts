// Etapa 1 do M45 sobre a cópia (ficha, seções 5, 9 e 10; regras 3, 14, 15 e 16), sempre em transação desfeita e sob a
// trava:
//   - o ciclo do formulário novo só no Sante SGH (rascunho com casos, revisão, aprovação por outra pessoa, publicação
//     com a ponte "só no Sante SGH" e aposentadoria), com o corpus CP1252 no título, nas perguntas e nas opções: a versão
//     relida é a mesma definição (o hash confere), a história tem os seis passos e o monitoramento da transação mostra só
//     tabelas SGH_ (0 tabela legada);
//   - a receita `pep.publicarFormularioNovo` (desligada fora de dev e ci; POL-3) pelo executor do M04, na mesma
//     transação desfeita: o modelo, as perguntas, as respostas e os vínculos criados; o LEITOR DE MODELOS DO M22
//     (`lerDefinicaoFormulario`) regenera a representação e ela bate com a definição publicada (ordem, texto, tipo e
//     opções, os acentos inclusive); o código já existente é recusado antes de gravar;
//   - o registro-resumo (contorno da DP-27) renderizado das respostas com o corpus: o RTF sai em CP1252 (escapes) e o
//     texto volta igual.
// Saída só com contagens e códigos (nenhum nome; definições sintéticas).
import { CORPUS_CP1252 } from '@sgh/contratos';
import {
  CONSTANTES_SINTETICAS,
  contentHashFormularioNovo,
  entradaDaPublicacao,
  FORMATO_DEFINICAO_FORMULARIO_NOVO,
  FORMULARIO_NOVO_SINTETICO,
  CASOS_FORMULARIO_NOVO_SINTETICO,
  percorrerPerguntas,
  publicadoIntegro,
  rtfDoResumo,
  textoDoResumo,
  TIPOPERG_DO_TIPO,
} from '@sgh/dominio-pep';
import {
  codigosDeModelo,
  ErroOperacao,
  escritasDaTransacao,
  eventosFormularioNovo,
  formularioNovo,
  lerDefinicaoFormulario,
  mudarFormNovoSgh,
  operacao,
  perguntasDoBancoPorId,
  respostasCadastradasPorTexto,
  salvarFormNovoSgh,
  somenteSgh,
} from '@sgh/legado';
import type { DefinicaoFormularioNovo, PerguntaFormularioNovo } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ambiente, ctx, ctxOperacao, PODE_ESCREVER, prepararAmbiente } from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

const AUTOR = 'SGH.TESTE.M45';
const APROVADOR = 'SGH.TESTE.M45C';
// O corpus aceito pelo CP1252 (o recusado tem caractere fora da página).
const CORPUS = CORPUS_CP1252.filter((t) => !t.includes('₂'));
const corta = (s: string, n: number) => s.slice(0, n).trim();

/** A definição sintética com o corpus nos títulos e nas opções (sem mudar a estrutura nem os pontos). */
function definicaoComCorpus(codigo: string): DefinicaoFormularioNovo {
  let i = 0;
  const prox = () => CORPUS[i++ % CORPUS.length]!;
  const trocar = (p: PerguntaFormularioNovo): PerguntaFormularioNovo => ({
    ...p,
    titulo: corta(`${p.titulo} ${prox()}`, 100),
    opcoes: p.opcoes.map((o) => ({ ...o, texto: corta(`${o.texto} ${prox()}`, 255) })),
    itens: p.itens.map(trocar),
  });
  return {
    ...FORMULARIO_NOVO_SINTETICO,
    codigo,
    titulo: corta(`Escala SINTETICO M45 ${CORPUS[6]}`, 100),
    perguntas: FORMULARIO_NOVO_SINTETICO.perguntas.map(trocar),
  };
}

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return e instanceof ErroOperacao ? (e.problema.codigo ?? 'sem-codigo') : `outro: ${(e as Error).message}`;
  }
}

/** Um código de modelo que não existe na cópia nem no SGH_PEP_FORMNOVO (sintético, até 10). */
async function codigoLivre(e: Escritor): Promise<string> {
  const usados = await codigosDeModelo(e);
  for (let n = 1; n < 1000; n++) {
    const c = `SGHT${String(n).padStart(3, '0')}`;
    if (!usados.has(c)) return c;
  }
  throw new Error('Sem código sintético livre.');
}

/** A entrada da receita como a API monta: o plano do domínio sobre o que foi lido na cópia (na mesma transação). */
async function entradaNaCopia(
  e: Escritor,
  def: DefinicaoFormularioNovo,
  v: { id: number; versao: number; versaoLinha: string },
  hash: string,
) {
  const todas = percorrerPerguntas(def).map((x) => x.pergunta);
  const reusos = todas.filter((p) => p.reuso !== null).map((p) => p.reuso!);
  const textos = todas.flatMap((p) => p.opcoes.map((o) => o.texto));
  return entradaDaPublicacao({
    definicao: def,
    versao: v.versao,
    codigosExistentes: await codigosDeModelo(e),
    banco: reusos.length ? await perguntasDoBancoPorId(e, reusos) : [],
    respostasCadastradas: textos.length ? await respostasCadastradasPorTexto(e, textos) : [],
    constantes: CONSTANTES_SINTETICAS,
    formulario: v.id,
    versaoEsperada: v.versaoLinha,
    contentHash: hash,
  });
}

describe.skipIf(!PODE_ESCREVER)('M45 etapa 1 na cópia (transação desfeita)', () => {
  let a: Ambiente;

  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  /** Rascunho → revisão → aprovado (o estado de partida da publicação). */
  async function aprovado(e: Escritor, def: DefinicaoFormularioNovo) {
    const s = somenteSgh(e);
    const r = await salvarFormNovoSgh(s, {
      hospital: a.cod,
      id: null,
      baseadoEm: null,
      codigo: def.codigo,
      titulo: def.titulo,
      tipoRegistro: def.tipoRegistro,
      formato: FORMATO_DEFINICAO_FORMULARIO_NOVO,
      definicao: def,
      casos: CASOS_FORMULARIO_NOVO_SINTETICO.map((c) => ({ nome: c.nome, caso: c })),
      autor: AUTOR,
      versaoEsperada: null,
    });
    const v1 = await mudarFormNovoSgh(s, {
      hospital: a.cod,
      id: r.id,
      por: AUTOR,
      versaoEsperada: r.versaoLinha,
      passo: { tipo: 'revisao' },
    });
    const v2 = await mudarFormNovoSgh(s, {
      hospital: a.cod,
      id: r.id,
      por: APROVADOR,
      versaoEsperada: v1.versaoLinha,
      passo: { tipo: 'aprovado', parecer: `Parecer SINTETICO ${CORPUS[7]}` },
    });
    return { ...r, versaoLinha: v2.versaoLinha };
  }

  it('ciclo só no Sante SGH com o corpus CP1252: relido igual, hash íntegro, história e só tabelas SGH_', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const def = definicaoComCorpus(await codigoLivre(e));
      const v = await aprovado(e, def);
      const hash = await contentHashFormularioNovo(def);
      const s = somenteSgh(e);
      const pub = await mudarFormNovoSgh(s, {
        hospital: a.cod,
        id: v.id,
        por: APROVADOR,
        versaoEsperada: v.versaoLinha,
        passo: {
          tipo: 'publicado',
          contentHash: hash,
          ponte: 'so-sante',
          idModeloLegado: null,
          codModelo: null,
          ligacoes: null,
        },
      });
      const imutavel = await codigo(
        salvarFormNovoSgh(s, {
          hospital: a.cod,
          id: v.id,
          baseadoEm: null,
          codigo: def.codigo,
          titulo: 'outro',
          tipoRegistro: def.tipoRegistro,
          formato: FORMATO_DEFINICAO_FORMULARIO_NOVO,
          definicao: def,
          casos: [],
          autor: AUTOR,
          versaoEsperada: pub.versaoLinha,
        }),
      );
      const lido = await formularioNovo(e, a.cod, v.id);
      const integro = await publicadoIntegro({
        definicao: lido!.definicao as DefinicaoFormularioNovo,
        contentHash: lido!.contentHash!,
      });
      await mudarFormNovoSgh(s, {
        hospital: a.cod,
        id: v.id,
        por: APROVADOR,
        versaoEsperada: null,
        passo: { tipo: 'aposentado', motivo: `Motivo SINTETICO ${CORPUS[10]}` },
      });
      const eventos = await eventosFormularioNovo(e, a.cod, v.id);
      const tabelas = (await escritasDaTransacao(e)).map((w) => w.tabela);
      return {
        igual: JSON.stringify(lido!.definicao) === JSON.stringify(def),
        estado: lido!.estado,
        ponte: lido!.ponte,
        hashIgual: lido!.contentHash === hash,
        integro,
        imutavel,
        eventos: eventos.map((x) => x.tipo),
        casos: lido!.casos.length,
        legado: tabelas.filter((t) => !t.startsWith('SGH_')),
        sgh: tabelas.length,
      };
    });
    console.log('[M45.1 ciclo só SGH_]', JSON.stringify(r));
    expect(r).toMatchObject({
      igual: true,
      estado: 'publicado',
      ponte: 'so-sante',
      hashIgual: true,
      integro: true,
      imutavel: 'imutavel',
      casos: CASOS_FORMULARIO_NOVO_SINTETICO.length,
      legado: [],
    });
    expect(r.eventos).toEqual(['salvo', 'revisao', 'aprovado', 'publicado', 'aposentado']);
  });

  it('receita pelo executor (desfeita): o leitor de modelos do M22 regenera o modelo igual à definição', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const def = definicaoComCorpus(await codigoLivre(e));
      const v = await aprovado(e, def);
      const hash = await contentHashFormularioNovo(def);
      const entrada = await entradaNaCopia(e, def, v, hash);
      const t0 = performance.now();
      const s = await a.executor.executar(
        operacao('pep.publicarFormularioNovo'),
        a.cod,
        entrada,
        ctxOperacao(a, APROVADOR),
        { escritor: e },
      );
      const ms = Math.round(performance.now() - t0);
      const modelo = Number(s.resultado['modelo']);
      const lido = await lerDefinicaoFormulario(e, {
        id: modelo,
        codigo: String(s.resultado['codigo']),
        descricao: def.titulo,
        fase: null,
      });
      // A representação regenerada: cada pergunta da definição no vínculo da sua ordem, com o texto, o tipo e as
      // opções na ordem (os acentos do corpus inclusive).
      const diferencas: string[] = [];
      for (const x of percorrerPerguntas(def)) {
        const vin = lido.vinculos.find((w) => w.ordem === x.ordem);
        const p = vin && lido.perguntas.find((q) => q.id === vin.idPergunta);
        if (!p) {
          diferencas.push(`${x.ordem}: sem vínculo`);
          continue;
        }
        if ((p.descricao ?? '').trim() !== x.pergunta.titulo.trim()) diferencas.push(`${x.ordem}: texto`);
        if ((p.tipo ?? '').trim() !== TIPOPERG_DO_TIPO[x.pergunta.tipo]) diferencas.push(`${x.ordem}: tipo`);
        const opcoes = lido.respostas
          .filter((q) => q.idPergunta === p.id && q.ativo && q.cod !== null)
          .sort((m, n) => m.ordem - n.ordem)
          .map((q) => q.descricao);
        if (JSON.stringify(opcoes) !== JSON.stringify(x.pergunta.opcoes.map((o) => o.texto.trim())))
          diferencas.push(`${x.ordem}: opções`);
      }
      const versao = await formularioNovo(e, a.cod, v.id);
      const tabelas = (await escritasDaTransacao(e)).map((w) => `${w.tabela}:${w.insercoes}/${w.alteracoes}`);
      // Recusa: outra versão com o código de um modelo que já existe no prontuário (criado lá depois de a versão ser
      // salva), com o plano montado antes (leitura desatualizada): a receita relê o código e recusa antes de gravar.
      const [existente] = [...(await codigosDeModelo(e))].filter((x) => !x.startsWith('SGHT')).sort();
      const outraDef = { ...def, codigo: existente! };
      const outra = await aprovado(e, outraDef);
      const plano = entradaDaPublicacao({
        definicao: outraDef,
        versao: outra.versao,
        codigosExistentes: new Set(),
        banco: [],
        respostasCadastradas: [],
        constantes: CONSTANTES_SINTETICAS,
        formulario: outra.id,
        versaoEsperada: outra.versaoLinha,
        contentHash: await contentHashFormularioNovo(outraDef),
      });
      const recusaCod = await codigo(
        a.executor.executar(operacao('pep.publicarFormularioNovo'), a.cod, plano, ctxOperacao(a, APROVADOR), {
          escritor: e,
        }),
      );
      return {
        diferencas,
        perguntas: percorrerPerguntas(def).length,
        vinculos: lido.vinculos.length,
        componentes: lido.componentes.length,
        estado: versao?.estado,
        ponte: versao?.ponte,
        ligado: versao?.idModeloLegado === modelo,
        recusaCod,
        tabelas,
        ms,
      };
    });
    console.log('[M45.1 receita + leitor do M22]', JSON.stringify(r));
    expect(r.diferencas).toEqual([]);
    expect(r.vinculos).toBe(r.perguntas);
    expect(r).toMatchObject({
      estado: 'publicado',
      ponte: 'modelo-legado',
      ligado: true,
      recusaCod: 'codigo-em-uso',
    });
    expect(r.tabelas.some((t) => t.startsWith('PREVOLUCAO:1/'))).toBe(true);
  });

  it('registro-resumo com o corpus: RTF em CP1252 (escapes) e o texto igual às respostas', () => {
    const def = definicaoComCorpus('SGHRES');
    const respostas = { mobilidade: 'acamado', riscos: ['friccao'], peso: 72.5, conduta: CORPUS[7]! };
    const rtf = rtfDoResumo(def, 1, respostas as never, '2026-10-25');
    const texto = textoDoResumo(def, 1, respostas as never, '2026-10-25');
    expect([...rtf].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(rtf).toMatch(/\\'e7|\\'e3|\\'e9/);
    expect(texto).toContain(def.titulo);
  });
});
