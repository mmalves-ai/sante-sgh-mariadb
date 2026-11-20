// Etapa 4 do M55 sobre a cópia (ficha, seções 4, 6, 10 e 11), sempre em transação desfeita e sob a trava:
//   - o pregão inteiro nas tabelas SGH_SUP_LICITACAO* (0554): termo com itens, pesquisa de preços, o estimado gravado,
//     parecer, aviso no prazo, sessão, propostas de fornecedores do cadastro, julgamento por item, recurso e decisão,
//     ata; as leituras (lista, detalhe com as parcelas, painel) com os tempos;
//   - a contratação direta até a homologação por outra pessoa e o pedido de compra do vencedor ligado pelo ID do
//     cabeçalho (lido; nada gravado no pedido);
//   - a consulta dos pedidos marcados como licitação (GEDESPDS, inteira);
//   - o ROLLBACK conferido pelas contagens das tabelas SGH_ do teste iguais antes e depois.
// Saída só com contagens, códigos e tempos (dados sintéticos).
import {
  avancarLicitacaoSgh,
  criarLicitacaoSgh,
  detalharLicitacao,
  ErroOperacao,
  homologarLicitacaoSgh,
  listarLicitacoes,
  operacao,
  painelLicitacoes,
  pedidosMarcadosLicitacao,
  descartarPrecoLicitacaoSgh,
  registrarDocumentoLicitacaoSgh,
  registrarEventoLicitacaoSgh,
  registrarPrecoLicitacaoSgh,
  registrarPropostaLicitacaoSgh,
} from '@sgh/legado';
import {
  esquemaAvancarLicitacao,
  esquemaCriarLicitacao,
  esquemaDescartarPrecoLicitacao,
  esquemaFiltroLicitacoes,
  esquemaRegistrarEventoLicitacao,
  esquemaRegistrarPrecoLicitacao,
  esquemaRegistrarPropostaLicitacao,
  PARAMETROS_LICITACAO_PADRAO as PARAM,
} from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginLivre, usuarioSintetico } from '../massa/sintetica.js';
import {
  type Ambiente,
  contar,
  ctx,
  ctxOperacao,
  num,
  PODE_ESCREVER,
  prepararAmbiente,
} from './escrita.spec-util.js';

type Escritor = Parameters<Parameters<Ambiente['nucleo']['desfazendoNaCopia']>[1]>[0];

const codigoDe = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'gravou';
  } catch (x) {
    if (x instanceof ErroOperacao) return x.problema.codigo ?? x.problema.type;
    throw x;
  }
};

/** Dia útil anterior a hoje menos `n` dias corridos (AAAA-MM-DD). */
const diaMenos = (hoje: string, n: number) => {
  const d = new Date(`${hoje}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!PODE_ESCREVER)('M55 etapa 4 na cópia (transação desfeita)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  const retrato = () =>
    a.nucleo.lerSomente(ctx(a), async (l) => ({
      processo: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_LICITACAO'),
      item: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_LICITACAO_ITEM'),
      preco: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_LICITACAO_PRECO'),
      descarte: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_LICITACAO_PRECO_DESC'),
      proposta: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_LICITACAO_PROPOSTA'),
      evento: await contar(l, 'SELECT COUNT(*) N FROM SGH_SUP_LICITACAO_EVENTO'),
      gecadped: await contar(l, 'SELECT MAX(ID) N FROM GECADPED'),
    }));

  async function agente(e: Escritor): Promise<string> {
    const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
    await a.executor.executar(
      operacao('acesso.criarUsuarioIntegracao'),
      a.cod,
      usuarioSintetico('usuario-tecnico', login),
      ctxOperacao(a, 'SGH.TESTE'),
      { escritor: e },
    );
    return login;
  }

  /** Dois fornecedores do cadastro com pedido recente (só os códigos) e um pedido de compra do primeiro. */
  async function fornecedoresEPedido(e: Escritor): Promise<{ f: [number, number]; pedido: number }> {
    const fs = await e.consultar(
      `SELECT FIRST 2 c.FORN FROM GECADPED c WHERE c.ANO >= 2025 AND c.OQUE = 'P' AND c.FORN > 0
        AND EXISTS (SELECT 1 FROM TBFORNEC t WHERE t.COD = c.FORN) GROUP BY c.FORN ORDER BY COUNT(*) DESC`,
      [],
      { teto: 2 },
    );
    const f: [number, number] = [num(fs[0]?.['FORN']), num(fs[1]?.['FORN'])];
    const [p] = await e.consultar(
      `SELECT FIRST 1 c.ID FROM GECADPED c WHERE c.ANO >= 2025 AND c.OQUE = 'P' AND c.FORN = ? ORDER BY c.ID DESC`,
      [f[0]],
      { teto: 1 },
    );
    return { f, pedido: num(p?.['ID']) };
  }

  it('o pregão até a ata: etapas, estimado, julgamento por item, recurso e decisão; leituras com os tempos', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const login = await agente(e);
      const { f } = await fornecedoresEPedido(e);
      const [h] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
        teto: 1,
      });
      const hoje = String(h?.['H']);
      const m = { hospital: a.cod, usuario: login, parametros: PARAM };
      const c = await criarLicitacaoSgh(e, {
        ...m,
        entrada: esquemaCriarLicitacao.parse({
          chave: `m554-int-${Date.now()}`,
          numero: `SINT-PE-${Date.now() % 1_000_000}`,
          regime: 'lei-14133',
          modalidade: 'pregao-eletronico',
          natureza: 'bens',
          objeto: 'Aquisição sintética de luvas de procedimento',
          justificativa: 'Teste de integração sintético na cópia, desfeito',
          agente: login,
          itens: [
            { descricao: 'Luva sintética M', unidade: 'CX', quantidade: 100 },
            { descricao: 'Luva sintética G', unidade: 'CX', quantidade: 50 },
          ],
        }),
      });
      const id = c.licitacao;
      let v = 1;
      const k = (s: string) => `m554-${id}-${s}`;
      const av = async (x: Record<string, unknown>) => {
        const g = await avancarLicitacaoSgh(e, {
          ...m,
          licitacao: id,
          entrada: esquemaAvancarLicitacao.parse({ chave: k(String(x['para'])), versao: v, ...x }),
        });
        v++;
        return g;
      };
      const ev = async (x: Record<string, unknown>, usuario = login) => {
        const g = await registrarEventoLicitacaoSgh(e, {
          ...m,
          usuario,
          licitacao: id,
          entrada: esquemaRegistrarEventoLicitacao.parse({ chave: k(String(x['tipo'])), versao: v, ...x }),
        });
        v++;
        return g;
      };
      await av({ para: 'pesquisa' });
      const det0 = (await detalharLicitacao(e, a.cod, id, {
        parametros: PARAM,
        usuario: login,
        conduz: true,
      }))!;
      const itens = det0.itensDetalhe.map((i) => i.id);
      let n = 0;
      for (const [ix, item] of itens.entries())
        for (const valor of [10 + ix, 11 + ix, 13 + ix]) {
          await registrarPrecoLicitacaoSgh(e, {
            ...m,
            licitacao: id,
            entrada: esquemaRegistrarPrecoLicitacao.parse({
              chave: k(`preco-${++n}`),
              versao: v++,
              item,
              fonte: 'painel',
              referencia: 'Painel sintético',
              valor,
              data: diaMenos(hoje, 30),
            }),
          });
        }
      // O preço digitado errado (0948): registrado, descartado com a justificativa, fora da conta; o reenvio relido.
      const errado = await registrarPrecoLicitacaoSgh(e, {
        ...m,
        licitacao: id,
        entrada: esquemaRegistrarPrecoLicitacao.parse({
          chave: k('preco-errado'),
          versao: v++,
          item: itens[0],
          fonte: 'painel',
          referencia: 'Painel sintético (digitado errado)',
          valor: 10_000,
          data: diaMenos(hoje, 30),
        }),
      });
      const comErrado = (await detalharLicitacao(e, a.cod, id, {
        parametros: PARAM,
        usuario: login,
        conduz: true,
      }))!.estimativa.valorTotal;
      const descarte = esquemaDescartarPrecoLicitacao.parse({
        chave: k('descarte'),
        versao: v++,
        justificativa: 'Valor digitado errado: 10.000 no lugar de 10 (sintético).',
      });
      const desc = await descartarPrecoLicitacaoSgh(e, {
        ...m,
        licitacao: id,
        preco: errado.registro,
        entrada: descarte,
      });
      const descRepetido = await descartarPrecoLicitacaoSgh(e, {
        ...m,
        licitacao: id,
        preco: errado.registro,
        entrada: descarte,
      });
      const descDeNovo = await codigoDe(
        descartarPrecoLicitacaoSgh(e, {
          ...m,
          licitacao: id,
          preco: errado.registro,
          entrada: { ...descarte, chave: k('descarte-2'), versao: v },
        }),
      );
      v++; // a tentativa recusada travou o processo (a versão subiu) na mesma transação
      const detDesc = (await detalharLicitacao(e, a.cod, id, {
        parametros: PARAM,
        usuario: login,
        conduz: true,
      }))!;
      // Regra 10: o documento emitido ligado ao processo (o evento, sem mudar a versão); o reenvio não duplica.
      const emitido = {
        tipo: 'termo' as const,
        emissao: '00000000-0000-4000-8000-000000000554',
        sha256: 'a'.repeat(64),
        identificadorQr: 'SINT554QR',
        etapa: 'pesquisa',
      };
      const doc = await registrarDocumentoLicitacaoSgh(e, {
        hospital: a.cod,
        licitacao: id,
        documento: emitido,
        usuario: login,
      });
      const docRepetido = await registrarDocumentoLicitacaoSgh(e, {
        hospital: a.cod,
        licitacao: id,
        documento: emitido,
        usuario: login,
      });
      const detDoc = (await detalharLicitacao(e, a.cod, id, {
        parametros: PARAM,
        usuario: login,
        conduz: true,
      }))!;
      const pesquisa = {
        comErrado,
        semErrado: detDesc.estimativa.valorTotal,
        descartado: detDesc.precos.find((x) => x.id === errado.registro)?.descarte !== null,
        repetido: [desc.repetido, descRepetido.repetido],
        deNovo: descDeNovo,
        documentos: detDoc.eventos.filter((x) => x.tipo === 'documento' && x.referencia === emitido.emissao)
          .length,
        docRepetido: [doc.repetido, docRepetido.repetido],
        versaoDoc: detDoc.versao === detDesc.versao,
        feriados: detDoc.feriados.length,
      };
      await av({ para: 'edital' });
      await ev({
        tipo: 'parecer',
        data: diaMenos(hoje, 25),
        resultado: 'favoravel',
        descricao: 'Parecer sintético favorável',
      });
      const prazoCurto = await codigoDe(
        avancarLicitacaoSgh(e, {
          ...m,
          licitacao: id,
          entrada: esquemaAvancarLicitacao.parse({
            chave: k('curto'),
            versao: v,
            para: 'publicado',
            dataPublicacao: diaMenos(hoje, 3),
            dataAbertura: diaMenos(hoje, 1),
            veiculo: 'pncp',
            referencia: 'Controle sintético',
          }),
        }),
      );
      v++; // a tentativa recusada travou o processo (a versão subiu) na mesma transação
      await av({
        para: 'publicado',
        dataPublicacao: diaMenos(hoje, 25),
        dataAbertura: diaMenos(hoje, 2),
        veiculo: 'pncp',
        referencia: 'Controle sintético',
      });
      await av({ para: 'sessao' });
      for (const [ix, item] of itens.entries())
        for (const [j, forn] of f.entries())
          await registrarPropostaLicitacaoSgh(e, {
            ...m,
            licitacao: id,
            entrada: esquemaRegistrarPropostaLicitacao.parse({
              chave: k(`prop-${ix}-${j}`),
              versao: v++,
              item,
              fornecedor: forn,
              valor: 10 + ix + j * 0.5,
            }),
          });
      await av({ para: 'julgado' });
      const julgado = (await detalharLicitacao(e, a.cod, id, {
        parametros: PARAM,
        usuario: login,
        conduz: true,
      }))!;
      const recurso = await ev({
        tipo: 'recurso',
        data: hoje,
        fornecedor: f[1],
        descricao: 'Razões sintéticas do recurso',
      });
      const decisao = await ev(
        {
          tipo: 'decisao-recurso',
          data: hoje,
          resultado: 'nao-provido',
          descricao: 'Decisão sintética do recurso',
        },
        'SGH.AUTORIDADE',
      );
      const ata = await ev({ tipo: 'ata', data: hoje, referencia: 'ATA-SINT-1', validade: null });
      const t: Record<string, number> = {};
      const medir = async <T>(nome: string, fn: () => Promise<T>) => {
        const i = performance.now();
        const x = await fn();
        t[nome] = Math.round(performance.now() - i);
        return x;
      };
      const lista = await medir('lista', () => listarLicitacoes(e, a.cod, esquemaFiltroLicitacoes.parse({})));
      const det = (await medir('detalhe', () =>
        detalharLicitacao(e, a.cod, id, { parametros: PARAM, usuario: 'OUTRO', conduz: false }),
      ))!;
      const painel = await medir('painel', () => painelLicitacoes(e, a.cod));
      return {
        t,
        prazoCurto,
        fornecedores: f.filter((x) => x > 0).length,
        estimado: julgado.valorEstimado,
        vencedores: julgado.itensDetalhe.map((i) => i.vencedor === f[0]),
        total: julgado.julgamento?.valorTotal,
        recurso: recurso.etapa,
        decisao: decisao.etapa,
        ata: ata.etapa,
        lista: lista.itens.length,
        etapa: det.etapa,
        eventos: det.eventos.length,
        andamento: painel.emAndamento,
        pesquisa,
      };
    });
    console.log(JSON.stringify(r));
    expect(r.fornecedores).toBe(2);
    expect(r.prazoCurto).toBe('licitacao-prazo-aviso');
    expect(r.estimado).toBe(1_100 + 600);
    expect(r.vencedores).toEqual([true, true]);
    expect(r.total).toBe(1_000 + 550);
    expect([r.recurso, r.decisao, r.ata]).toEqual(['recurso', 'julgado', 'julgado']);
    expect(r.lista).toBeGreaterThanOrEqual(1);
    expect(r.etapa).toBe('julgado');
    expect(r.andamento).toBeGreaterThanOrEqual(1);
    expect(r.t['detalhe']).toBeLessThan(500);
    expect(r.pesquisa.comErrado).toBeGreaterThan(1_100 + 600);
    expect(r.pesquisa.semErrado).toBe(1_100 + 600);
    expect(r.pesquisa.descartado).toBe(true);
    expect(r.pesquisa.repetido).toEqual([false, true]);
    expect(r.pesquisa.deNovo).toBe('licitacao-preco-descartado');
    expect(r.pesquisa.documentos).toBe(1);
    expect(r.pesquisa.docRepetido).toEqual([false, true]);
    expect(r.pesquisa.versaoDoc).toBe(true);
    expect(r.pesquisa.feriados).toBeGreaterThanOrEqual(0);
    expect(await retrato()).toEqual(antes);
  });

  it('a contratação direta homologada por outra pessoa e o pedido do vencedor ligado pelo ID; os pedidos marcados', async () => {
    const antes = await retrato();
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e: Escritor) => {
      const login = await agente(e);
      const { f, pedido } = await fornecedoresEPedido(e);
      const m = { hospital: a.cod, usuario: login, parametros: PARAM };
      const [h] = await e.consultar('SELECT CAST(CURRENT_DATE AS VARCHAR(10)) H FROM RDB$DATABASE', [], {
        teto: 1,
      });
      const hoje = String(h?.['H']);
      const c = await criarLicitacaoSgh(e, {
        ...m,
        entrada: esquemaCriarLicitacao.parse({
          chave: `m554-dl-${Date.now()}`,
          numero: `SINT-DL-${Date.now() % 1_000_000}`,
          regime: 'lei-14133',
          modalidade: 'dispensa',
          fundamento: 'art. 75, II',
          natureza: 'servico-comum',
          objeto: 'Serviço sintético de calibração de equipamentos',
          justificativa: 'Teste de integração sintético na cópia, desfeito',
          agente: login,
          itens: [{ descricao: 'Calibração sintética', unidade: 'UN', quantidade: 1 }],
        }),
      });
      const id = c.licitacao;
      let v = 1;
      const k = (s: string) => `m554-dl-${id}-${s}`;
      await avancarLicitacaoSgh(e, {
        ...m,
        licitacao: id,
        entrada: esquemaAvancarLicitacao.parse({ chave: k('p'), versao: v++, para: 'pesquisa' }),
      });
      const item = (await detalharLicitacao(e, a.cod, id, {
        parametros: PARAM,
        usuario: login,
        conduz: true,
      }))!.itensDetalhe[0]!.id;
      await registrarPrecoLicitacaoSgh(e, {
        ...m,
        licitacao: id,
        entrada: esquemaRegistrarPrecoLicitacao.parse({
          chave: k('preco'),
          versao: v++,
          item,
          fonte: 'fornecedor',
          referencia: 'Cotação sintética',
          valor: 5_000,
          data: hoje,
          fornecedor: f[0],
        }),
      });
      await avancarLicitacaoSgh(e, {
        ...m,
        licitacao: id,
        entrada: esquemaAvancarLicitacao.parse({
          chave: k('s'),
          versao: v++,
          para: 'sessao',
          justificativaPesquisa: 'Prestador único credenciado (sintético)',
        }),
      });
      await registrarPropostaLicitacaoSgh(e, {
        ...m,
        licitacao: id,
        entrada: esquemaRegistrarPropostaLicitacao.parse({
          chave: k('prop'),
          versao: v++,
          item,
          fornecedor: f[0],
          valor: 4_800,
        }),
      });
      await avancarLicitacaoSgh(e, {
        ...m,
        licitacao: id,
        entrada: esquemaAvancarLicitacao.parse({ chave: k('j'), versao: v++, para: 'julgado' }),
      });
      const homologa = (usuario: string) =>
        codigoDe(
          homologarLicitacaoSgh(e, {
            ...m,
            usuario,
            licitacao: id,
            entrada: { chave: k(`h-${usuario}`), versao: v, observacao: null },
          }),
        );
      const segregacao = await homologa(login);
      v++; // a tentativa recusada travou o processo (a versão subiu) na mesma transação
      const homologado = await homologa('SGH.AUTORIDADE');
      v++;
      const ligar = (p: number, s: string) =>
        codigoDe(
          registrarEventoLicitacaoSgh(e, {
            ...m,
            licitacao: id,
            entrada: esquemaRegistrarEventoLicitacao.parse({
              chave: k(s),
              versao: v,
              tipo: 'pedido',
              pedido: p,
            }),
          }),
        );
      const inexistente = await ligar(2_000_000_000, 'ped0');
      v++;
      const ligado = await ligar(pedido, 'ped1');
      v++;
      const repetido = await ligar(pedido, 'ped2');
      const i = performance.now();
      const marcados = await pedidosMarcadosLicitacao(e);
      const tMarcados = Math.round(performance.now() - i);
      return {
        segregacao,
        homologado,
        inexistente,
        ligado,
        repetido,
        marcados: marcados.length,
        comPedido: marcados.filter((x) => x.pedido !== null).length,
        comTexto: marcados.filter((x) => x.descricao.length > 0).length,
        tMarcados,
      };
    });
    console.log(JSON.stringify(r));
    expect(r.segregacao).toBe('licitacao-segregacao');
    expect(r.homologado).toBe('gravou');
    expect(r.inexistente).toBe('licitacao-pedido-inexistente');
    expect(r.ligado).toBe('gravou');
    expect(r.repetido).toBe('licitacao-pedido-repetido');
    expect(r.marcados).toBe(23);
    expect(r.comPedido).toBe(23);
    expect(r.comTexto).toBeGreaterThan(0);
    expect(await retrato()).toEqual(antes);
  });
});
