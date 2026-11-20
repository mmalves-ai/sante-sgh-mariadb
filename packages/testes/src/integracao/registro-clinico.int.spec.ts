// Registro clínico na cópia (ficha do M22, seção 10), pelo EXECUTOR, em transação desfeita (ROLLBACK): o registro
// de um profissional da cópia (login e CBO só em memória) com respostas SINTÉTICAS sobre o modelo convertido na
// hora; o relido pelo leitor do M15 confere 100% com o formulário gravado; texto formatado acima de 32 KB (BLOB
// segmentado) relido byte a byte; o documento da trilha documental em base64 + zlib (Windows-1252) relido e
// descomprimido; a prova guardada (SGH_PEP_DOC) confere; rascunho salvo de novo encadeado na versão anterior
// (arquivada, como o legado), colisão (409) e finalizado (marcado excluído); o rascunho começado no outro sistema
// é recusado; a alteração feita pelo outro sistema depois da gravação aparece na prova (regra 11); descarte e
// suspensão pelo executor; suspensão pela metade recusada pelo gatilho do banco com a explicação em português; o
// ROLLBACK devolve tudo (maiores chaves do legado e da trilha dupla, linhas recentes e contagens SGH_). Saída só
// com contagens.
import {
  ErroOperacao,
  lerCabecalhoRegistro,
  lerConteudoRegistro,
  lerProvaDoRegistro,
  lerRascunho,
  operacao,
  problemaDoLegado,
  respostasDoRegistro,
} from '@sgh/legado';
import { conferirGravado, respostasDasLinhas, respostasSinteticas, taxaIgualdade } from '@sgh/dominio-pep';
import type { RespostaRegistro } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  atendimento,
  gravacaoEvolucao,
  gravacaoRascunho,
  modeloPronto,
  profissional,
  rascunhoDoOutroSistema,
  suspensaoDe,
} from '../massa/reproducao-pep.js';
import {
  alterarComoOutroSistema,
  bytesDoTextoFormatado,
  documentoDoRegistro,
  estadoRegistroClinico,
  eventosESuspensao,
  rascunhoFinalizado,
  situacaoRascunho,
  suspenderPelaMetade,
} from '../massa/registro-clinico.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

/** Texto formatado longo (acima de 32 KB no RTF): o BLOB vai em segmentos. */
function textoLongo(vinculo: number): RespostaRegistro {
  const linha = 'SINTETICO M22 evolução — coração “sem queixas” ação ºC € ';
  return {
    vinculo,
    valor: {
      tipo: 'formatado',
      paragrafos: Array.from({ length: 700 }, (_, i) => ({
        alinhamento: 'esquerda' as const,
        recuo: 0,
        trechos: [{ texto: `${linha}${i}`, negrito: i % 7 === 0, italico: false, sublinhado: false, cor: 0 }],
      })),
    },
    autopreenchido: false,
    confirmado: false,
  };
}

describe.skipIf(!PODE_ESCREVER)('registro clínico na cópia (transação desfeita)', () => {
  let a: Ambiente;
  let antes: Record<string, number>;
  beforeAll(async () => {
    a = await prepararAmbiente();
    antes = await a.nucleo.lerSomente(ctx(a), (l) => estadoRegistroClinico(l));
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('registro EVAM com texto acima de 32 KB: relido confere 100%, documento base64+zlib, prova confere', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const m = await modeloPronto(e, 'EVAM');
      const prof = await profissional(e, m.id);
      const at = await atendimento(e, 'I');
      const base = respostasSinteticas(m.rep, { acentos: true });
      const primeiro = base.find((x) => x.valor.tipo === 'formatado');
      if (!primeiro) throw new Error('EVAM sem texto formatado.');
      const respostas = base.map((x) => (x.vinculo === primeiro.vinculo ? textoLongo(x.vinculo) : x));
      const g = await gravacaoEvolucao(e, a.cod, m, prof, at, respostas);
      const s = await a.executor.executar(
        operacao('pep.registrarEvolucao'),
        a.cod,
        g,
        ctxOperacao(a, prof.login),
        {
          escritor: e,
        },
      );
      const registro = num(s.resultado['registro']);
      const conteudo = await lerConteudoRegistro(e, registro, { rtf: true, xml: true });
      const linhas = await respostasDoRegistro(e, registro);
      const conf = conferirGravado(m.rep, linhas, conteudo?.xml ?? '');
      const lidas = respostasDasLinhas(m.rep, linhas).respostas;
      const xmlDoc = await documentoDoRegistro(e, registro);
      const prova = await lerProvaDoRegistro(e, a.cod, registro);
      const rtfBytes = await bytesDoTextoFormatado(e, registro);
      return {
        registro,
        rtf: rtfBytes,
        taxa: taxaIgualdade(conf),
        respostas: lidas.length,
        enviadas: respostas.length,
        temIdNoDoc: xmlDoc.includes(`<id_prcabevol>${registro}</id_prcabevol>`),
        acentosNoDoc: xmlDoc.includes('coração'),
        prova: prova.guardado !== null && prova.guardado === prova.atual,
        hash: s.resultado['hash'],
        hashConteudo: prova.hashConteudo,
      };
    });
    expect(r.rtf).toBeGreaterThan(32_768);
    expect(r.taxa).toBe(1);
    expect(r.respostas).toBe(r.enviadas);
    expect(r.temIdNoDoc).toBe(true);
    expect(r.acentosNoDoc).toBe(true);
    expect(r.prova).toBe(true);
    expect(r.hashConteudo).toBe(r.hash);
    console.log(
      `[${a.cod}] registro: RTF ${r.rtf} bytes; ${r.respostas} respostas relidas; conferência ${r.taxa}`,
    );
  });

  it('rascunho: salvar de novo encadeia e arquiva a anterior; colisão 409; finalizado fica excluído; o do outro sistema é recusado', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const m = await modeloPronto(e, 'EVAM');
      const prof = await profissional(e, m.id);
      const at = await atendimento(e, 'E');
      const todas = respostasSinteticas(m.rep);
      const salvar = (ent: unknown) =>
        a.executor.executar(operacao('pep.salvarRascunho'), a.cod, ent, ctxOperacao(a, prof.login), {
          escritor: e,
        });
      const codigo = async (p: Promise<unknown>) => {
        try {
          await p;
          return 'gravou';
        } catch (x) {
          return x instanceof ErroOperacao ? (x.problema.codigo ?? '') : 'outro';
        }
      };
      const s1 = await salvar(await gravacaoRascunho(e, m, prof, at, todas.slice(0, 1)));
      const v1 = { id: num(s1.resultado['rascunho']), versao: String(s1.resultado['versao']) };
      const s2 = await salvar(await gravacaoRascunho(e, m, prof, at, todas.slice(0, 2), v1));
      const v2 = { id: num(s2.resultado['rascunho']), versao: String(s2.resultado['versao']) };
      const colisao = await codigo(salvar(await gravacaoRascunho(e, m, prof, at, todas, v1)));
      const anterior = await situacaoRascunho(e, v1.id);
      const nova = await situacaoRascunho(e, v2.id);
      // A leitura do rascunho (a tela) sobre o banco de verdade: a versão nova, do novo, no atendimento.
      const lido = await lerRascunho(e, v2.id, a.cod);
      await a.executor.executar(
        operacao('pep.registrarEvolucao'),
        a.cod,
        await gravacaoEvolucao(e, a.cod, m, prof, at, todas, { rascunho: v2 }),
        ctxOperacao(a, prof.login),
        { escritor: e },
      );
      const outro = await rascunhoDoOutroSistema(e, m, prof, at);
      const deOutroSistema = await codigo(
        salvar(await gravacaoRascunho(e, m, prof, at, todas.slice(0, 1), outro)),
      );
      return {
        encadeado: v2.id !== v1.id && nova.anterior === v1.id,
        anteriorArquivada: anterior.arquivado && !anterior.excluido,
        novaAberta: !nova.arquivado && !nova.excluido,
        colisao,
        finalizado: await rascunhoFinalizado(e, v2.id),
        lido: lido?.aberto === true && lido.rascunho.doNovo && lido.rascunho.atendimento === at.id,
        deOutroSistema,
      };
    });
    expect(r).toEqual({
      encadeado: true,
      anteriorArquivada: true,
      novaAberta: true,
      colisao: 'conflito-versao',
      finalizado: true,
      lido: true,
      deOutroSistema: 'rascunho-de-outro-sistema',
    });
  });

  it('regra 11: a alteração feita pelo outro sistema depois da gravação aparece na prova', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const m = await modeloPronto(e, 'EVAM');
      const prof = await profissional(e, m.id);
      const at = await atendimento(e, 'I');
      const s = await a.executor.executar(
        operacao('pep.registrarEvolucao'),
        a.cod,
        await gravacaoEvolucao(e, a.cod, m, prof, at, respostasSinteticas(m.rep)),
        ctxOperacao(a, prof.login),
        { escritor: e },
      );
      const registro = num(s.resultado['registro']);
      // As leituras da visualização e da suspensão (o cabeçalho com o atendimento) sobre o banco de verdade.
      const cab = await lerCabecalhoRegistro(e, registro);
      const antes = await lerProvaDoRegistro(e, a.cod, registro);
      const alteradas = await alterarComoOutroSistema(e, registro);
      const depois = await lerProvaDoRegistro(e, a.cod, registro);
      return {
        cabecalho: cab?.paciente === at.paciente && cab.atendimento === at.id && cab.corrige === null,
        confere: antes.guardado !== null && antes.guardado === antes.atual,
        alteradas,
        alterado: depois.guardado === antes.guardado && depois.atual !== depois.guardado,
      };
    });
    expect(r).toEqual({ cabecalho: true, confere: true, alteradas: 1, alterado: true });
  });

  it('descarte e suspensão pelo executor: o rascunho fica excluído; o registro, suspenso com o evento na prova', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const m = await modeloPronto(e, 'EVAM');
      const prof = await profissional(e, m.id);
      const at = await atendimento(e, 'I');
      const op = (nome: string, ent: unknown) =>
        a.executor.executar(operacao(nome), a.cod, ent, ctxOperacao(a, prof.login), { escritor: e });
      const respostas = respostasSinteticas(m.rep);
      const s1 = await op(
        'pep.salvarRascunho',
        await gravacaoRascunho(e, m, prof, at, respostas.slice(0, 1)),
      );
      const rascunho = num(s1.resultado['rascunho']);
      await op('pep.descartarRascunho', {
        rascunho,
        versao: String(s1.resultado['versao']),
        cbo: prof.cbo,
      });
      const g = await op('pep.registrarEvolucao', await gravacaoEvolucao(e, a.cod, m, prof, at, respostas));
      const registro = num(g.resultado['registro']);
      await op('pep.suspenderEvolucao', await suspensaoDe(e, m, prof, at, respostas, registro));
      const x = await eventosESuspensao(e, a.cod, registro);
      return {
        descartado: (await situacaoRascunho(e, rascunho)).excluido,
        suspenso: x.suspenso,
        eventos: x.eventos,
      };
    });
    expect(r).toEqual({ descartado: true, suspenso: true, eventos: 2 });
  });

  it('suspensão pela metade: o gatilho do banco recusa, com a explicação em português', async () => {
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const m = await modeloPronto(e, 'EVAM');
      const prof = await profissional(e, m.id);
      const at = await atendimento(e, 'I');
      const s = await a.executor.executar(
        operacao('pep.registrarEvolucao'),
        a.cod,
        await gravacaoEvolucao(e, a.cod, m, prof, at, respostasSinteticas(m.rep)),
        ctxOperacao(a, prof.login),
        { escritor: e },
      );
      try {
        await suspenderPelaMetade(e, num(s.resultado['registro']));
        return null;
      } catch (x) {
        return problemaDoLegado(x).problema;
      }
    });
    expect(r?.codigo).toBe('suspensao-incompleta');
    expect(r?.detail).toMatch(/quem suspende, quando e a justificativa/);
  });

  it('o ROLLBACK devolveu tudo (maiores chaves do legado e da trilha dupla, linhas recentes, contagens SGH_)', async () => {
    const depois = await a.nucleo.lerSomente(ctx(a), (l) => estadoRegistroClinico(l));
    expect(depois).toEqual(antes);
  });
});
