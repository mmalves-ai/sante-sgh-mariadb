// M56 (etapa 7, F6) na cópia: (1) pela porta do legado READ ONLY, a fatia desligada (regra 1; M61: desligada na transação desfeita), o apoio da tela
// com os domínios do banco do estabelecimento (motivos de movimentação cadastral, campos da retificação do SIB, valores
// da TPS), a lista e as contagens dentro do tempo-alvo e a gravação recusada em dev sobre a cópia compartilhada; (2) numa
// transação SEMPRE desfeita, o serviço dos envios inteiro sobre o banco real — a carteira da F1 sintética → a prévia do SIB
// com as pendências → o complemento → o SIB gerado (arquivo, SHA-256) → enviado ao simulador → o retorno simulado com o
// CCO → nenhum movimento novo; a TPS com a GRU; o DIOPS com o balancete conferido; o aviso de ressarcimento com a
// análise, a decisão e o protocolo da impugnação —, só tabelas SGH_ escritas (nenhuma do outro sistema), uma linha de
// trilha por gravação e as recusas. Dados SINTÉTICOS; no log, só contagens, códigos e tempos.
import { createHash } from 'node:crypto';
import {
  type Escritor,
  escritasDaTransacao,
  type LinhaTrilha,
  type NucleoLegado,
  quantidadeEnviosAnsSgh,
  trilhaDaOperadoraPorRecurso,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GravadorAns } from '../ans-porta.js';
import { portaAnsOperadoraLegado } from '../ans-porta-legado.js';
import { ServicoAnsOperadora } from '../ans-servico.js';
import {
  COD,
  codigoDe,
  criarNucleo,
  montarCarteira,
  PODE,
  servicoNaTransacao,
  sessao,
  USUARIO,
} from './copia.spec-util.js';
import { situacaoComChavesDesligadas } from './chaves-desligadas.spec-util.js';

let nucleo: NucleoLegado;
beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  await nucleo.verificarSchema(COD);
});
afterAll(async () => {
  if (PODE) await nucleo.encerrar();
});

const ENDERECO = {
  logradouro: 'Rua Sintética da Integração',
  numero: '10',
  complemento: null,
  bairro: 'Centro',
  municipio: 4205407,
  cep: '88000000',
  resideExterior: false,
  coberturaParcial: false,
  itensExcluidos: false,
  cco: null,
  motivoCancelamento: null,
};

describe.skipIf(!PODE)('envios da operadora à ANS na cópia (etapa 7, F6)', () => {
  it('a fatia desligada; o apoio com os domínios do banco, a lista e as contagens pela porta do legado; a gravação recusada em dev', async () => {
    const c = { rede: nucleo.rede, hospital: COD };
    const porta = portaAnsOperadoraLegado(nucleo, { sghSoLeitura: true });
    // M61: a cópia pode estar com a liberação full; a fatia é desligada na transação desfeita, sem depender dela.
    const s = await situacaoComChavesDesligadas(nucleo, COD, 'SINT.OPERADORA', ['operadora.ans']);
    expect(s.fatias.find((f) => f.chave === 'operadora.ans')?.situacao).toBe('desligada');
    const servico = new ServicoAnsOperadora(porta, 'dev');
    const t0 = performance.now();
    const apoio = await servico.apoio(c, { vale: false, motivo: 'desligada' });
    const msApoio = performance.now() - t0;
    expect(apoio.destino).toBe('simulador');
    expect(apoio.motivosSib).toHaveLength(12);
    expect(apoio.camposSib).toHaveLength(19);
    expect(apoio.valoresTps.length).toBeGreaterThan(0);
    expect(apoio.valoresTps.every((v) => v.valorTrimestral > 0)).toBe(true);
    const t1 = performance.now();
    const lista = await servico.lista(c, {});
    const msLista = performance.now() - t1;
    expect(msLista).toBeLessThan(300);
    expect(lista.itens.length).toBeLessThanOrEqual(50);
    await expect(porta.gravarSgh(c, {} as never, async () => ({ id: 1 }))).rejects.toMatchObject({
      status: 403,
    });
    console.log(
      `[int-m56-7] ${COD}: fatia dos envios desligada; apoio em ${Math.round(msApoio)} ms (${apoio.motivosSib.length} motivos, ${apoio.camposSib.length} campos, ${apoio.valoresTps.length} vigências da taxa); lista e contagens em ${Math.round(msLista)} ms (${lista.itens.length} envios); gravação recusada em dev`,
    );
  });

  it('o ciclo inteiro numa transação desfeita: só SGH_; uma trilha por gravação; as recusas', async () => {
    const ctx = { rede: nucleo.rede, hospital: COD, traceId: 'int-m56-7' };
    const contar = async (l: Pick<Escritor, 'consultar'>) =>
      (await trilhaDaOperadoraPorRecurso(l, COD, USUARIO))['operadora.ans'] ?? 0;
    const envios = (l: Pick<Escritor, 'consultar'>) => quantidadeEnviosAnsSgh(l, COD);
    const retrato = () =>
      nucleo.lerSomente(ctx, async (l) => ({ envios: await envios(l), trilhas: await contar(l) }));
    const antes = await retrato();
    const r = await nucleo.desfazendoNaCopia(ctx, async (e) => {
      const { servico: servicoF1 } = servicoNaTransacao(e);
      const s = sessao(nucleo.rede);
      const k = await montarCarteira(servicoF1, s, { registro: '990567', base: '99067' });
      const carteirinha = k.titular.carteirinha!;
      const sobreE = {
        lerSomente: ((_c: unknown, fn: (l: Escritor) => Promise<unknown>) =>
          fn(e)) as NucleoLegado['lerSomente'],
        gravarSgh: ((_c: unknown, fn: (l: Escritor) => Promise<unknown>) =>
          fn(e)) as NucleoLegado['gravarSgh'],
      };
      const c = { rede: nucleo.rede, hospital: COD };
      const porta = portaAnsOperadoraLegado(sobreE);
      const servico = new ServicoAnsOperadora(porta, 'dev');
      const { hoje } = await porta.relogio(c);
      const linha =
        (operacao: string, tabela = 'SGH_OPE_ENVIO_ANS') =>
        (x: { id: number }): LinhaTrilha => ({
          rede: nucleo.rede,
          hospital: COD,
          usuario: USUARIO,
          evento: operacao,
          recurso: 'operadora.ans',
          operacao,
          tabelaAlvo: tabela,
          idAlvo: String(x.id),
          chaveNaturalAlvo: null,
          resultado: 'sucesso',
          estacao: 'SGH-INTEGRACAO:m56-7',
          correlacao: 'integracao-m56-7',
          origem: 'SGH-INTEGRACAO:m56-7',
        });
      const gravar = <T extends { id: number }>(
        op: string,
        fn: (g: GravadorAns) => Promise<T>,
        tabela?: string,
      ) => porta.gravarSgh(c, linha(op, tabela), fn);
      const codigos = (ps: readonly { codigo: string }[]) => [...new Set(ps.map((p) => p.codigo))].sort();
      const ope = k.operadora;

      // SIB: a competência aberta, as pendências (endereço e a identificação do menor) e o complemento.
      const aberta = (
        await servico.montar(c, { operadora: ope, obrigacao: 'SIB', competencia: hoje.slice(0, 7) })
      ).previa;
      const t0 = performance.now();
      const sem = (await servico.montar(c, { operadora: ope, obrigacao: 'SIB', competencia: '2026-09' }))
        .previa;
      const msPrevia = performance.now() - t0;
      const pend = await servico.pendenciasSib(c, ope, 0);
      const complemento = async (b: number, x: Record<string, unknown>) => {
        const e0 = { versao: 0, ...ENDERECO, dnv: null, ...x } as never;
        await servico.conferirComplemento(c, b, e0);
        await gravar(
          'operadora.alterarComplementoSib',
          (g) => g.complemento({ ...(e0 as object), beneficiario: b, usuario: USUARIO } as never),
          'SGH_OPE_BENEF_SIB',
        );
        return servico.complemento(c, b);
      };
      const ct = await complemento(k.titular.id, {});
      const velhaComp = await codigoDe(
        servico.conferirComplemento(c, k.titular.id, { versao: 0, ...ENDERECO, dnv: null } as never),
      );
      await complemento(k.dependente, { dnv: '12345678901' });
      const previa = (await servico.montar(c, { operadora: ope, obrigacao: 'SIB', competencia: '2026-09' }))
        .previa;
      const gSib = await servico.gerar(c, { operadora: ope, obrigacao: 'SIB', competencia: '2026-09' });
      const sib = await gravar('operadora.gerarEnvioAns', (g) => g.gerar({ ...gSib, usuario: USUARIO }));
      const fichaSib = await servico.detalhe(c, sib.id);
      const arq = await servico.arquivo(c, sib.id);
      const hashConfere =
        createHash('sha256').update(Buffer.from(arq.base64, 'base64')).digest('hex') === arq.sha256;
      const comRecibo = await codigoDe(servico.conferirTransmissao(c, sib.id, { versao: 1, recibo: 'R1' }));
      const tx = await servico.conferirTransmissao(c, sib.id, { versao: 1 });
      await gravar('operadora.transmitirEnvioAns', (g) =>
        g.transmitir({
          id: sib.id,
          versao: 1,
          recibo: tx.recibo,
          arquivo: tx.arquivo,
          texto: tx.texto,
          usuario: USUARIO,
        }),
      );
      const aguardando = (
        await servico.montar(c, { operadora: ope, obrigacao: 'SIB', competencia: '2026-09' })
      ).previa;
      const velhaRet = await codigoDe(servico.conferirRetorno(c, sib.id, { versao: 1, simular: true }));
      const rt = await servico.conferirRetorno(c, sib.id, { versao: 2, simular: true });
      await gravar('operadora.registrarRetornoAns', (g) =>
        g.retorno({
          id: sib.id,
          versao: 2,
          situacao: rt.situacao,
          resumo: null,
          itens: rt.itens,
          sib: true,
          texto: rt.texto,
          usuario: USUARIO,
        }),
      );
      const aceitoTit = await servico.complemento(c, k.titular.id);
      const nada = (await servico.montar(c, { operadora: ope, obrigacao: 'SIB', competencia: '2026-09' }))
        .previa;
      const gruNoSib = await codigoDe(
        servico.conferirPagamento(c, sib.id, { versao: 3, gru: '1234567890', valor: 1, data: hoje }),
      );

      // TPS: a média do trimestre × o valor vigente; enviada, aceita e a GRU paga.
      const tpsPrevia = (
        await servico.montar(c, { operadora: ope, obrigacao: 'TPS', competencia: '2026-T3' })
      ).previa;
      const gTps = await servico.gerar(c, { operadora: ope, obrigacao: 'TPS', competencia: '2026-T3' });
      const tps = await gravar('operadora.gerarEnvioAns', (g) => g.gerar({ ...gTps, usuario: USUARIO }));
      const gruAntes = await codigoDe(
        servico.conferirPagamento(c, tps.id, { versao: 1, gru: '1234567890', valor: 1, data: hoje }),
      );
      const txT = await servico.conferirTransmissao(c, tps.id, { versao: 1 });
      await gravar('operadora.transmitirEnvioAns', (g) =>
        g.transmitir({
          id: tps.id,
          versao: 1,
          recibo: txT.recibo,
          arquivo: txT.arquivo,
          texto: txT.texto,
          usuario: USUARIO,
        }),
      );
      const rtT = await servico.conferirRetorno(c, tps.id, { versao: 2, simular: true });
      await gravar('operadora.registrarRetornoAns', (g) =>
        g.retorno({
          id: tps.id,
          versao: 2,
          situacao: rtT.situacao,
          resumo: null,
          itens: rtT.itens,
          sib: false,
          texto: rtT.texto,
          usuario: USUARIO,
        }),
      );
      const valorTps = gTps.valorTotal ?? 0;
      await servico.conferirPagamento(c, tps.id, {
        versao: 3,
        gru: '12345678901234',
        valor: valorTps,
        data: hoje,
      });
      await gravar('operadora.pagarGruAns', (g) =>
        g.pagar({
          id: tps.id,
          versao: 3,
          gru: '12345678901234',
          valor: valorTps,
          data: hoje,
          usuario: USUARIO,
        }),
      );
      const fichaTps = await servico.detalhe(c, tps.id);

      // DIOPS: sem balancete e desequilibrado recusam; equilibrado, gera.
      const balancete = {
        ativo: 1000,
        passivo: 600,
        patrimonioLiquido: 400,
        provisoesTecnicas: 100,
        responsavel: 'Contador SINTÉTICO',
      };
      const d0 = (await servico.montar(c, { operadora: ope, obrigacao: 'DIOPS', competencia: '2026-T3' }))
        .previa;
      const d1 = (
        await servico.montar(c, {
          operadora: ope,
          obrigacao: 'DIOPS',
          competencia: '2026-T3',
          balancete: { ...balancete, ativo: 999 },
        })
      ).previa;
      const d2 = (
        await servico.montar(c, { operadora: ope, obrigacao: 'DIOPS', competencia: '2026-T3', balancete })
      ).previa;

      // Ressarcimento ao SUS: o aviso com o titular e um desconhecido; a decisão; o protocolo da impugnação.
      const aviso = {
        operadora: ope,
        aviso: '9905671',
        recebidoEm: hoje,
        atendimentos: [
          {
            tipo: 'AIH' as const,
            numero: '4126000005671',
            identificacao: carteirinha,
            inicio: '2026-09-01',
            fim: '2026-09-04',
            procedimento: '0303010010',
            valor: 1500.5,
          },
          {
            tipo: 'APAC' as const,
            numero: '4126000005672',
            identificacao: '123456789012345',
            inicio: '2026-09-10',
            fim: '2026-09-10',
            procedimento: '0304010014',
            valor: 300,
          },
        ],
      };
      const gAv = await servico.registrarAviso(c, aviso);
      const res = await gravar('operadora.registrarAvisoRessarcimento', (g) =>
        g.gerar({ ...gAv, usuario: USUARIO }),
      );
      // O aviso repetido: a unicidade do banco (índice do aviso por operadora) recusa na gravação.
      const gRep = await servico.registrarAviso(c, aviso);
      const repetido = await codigoDe(
        gravar('operadora.registrarAvisoRessarcimento', (g) => g.gerar({ ...gRep, usuario: USUARIO })),
      );
      const fr = await servico.detalhe(c, res.id);
      const pendente = await codigoDe(servico.conferirTransmissao(c, res.id, { versao: 1 }));
      const decidir = async (
        versao: number,
        item: number,
        decisao: 'impugnar' | 'aceitar',
        motivo: string | null,
      ) => {
        const x = { versao, decisao, motivo, justificativa: null } as never;
        const d = await servico.conferirDecisao(c, res.id, item, x);
        return gravar('operadora.decidirAtendimentoRessarcimento', (g) =>
          g.decidir({
            id: res.id,
            versao,
            item,
            decisao,
            motivo: motivo as never,
            justificativa: null,
            texto: d.texto,
            usuario: USUARIO,
          }),
        );
      };
      const semMotivo = await codigoDe(
        servico.conferirDecisao(c, res.id, fr.itens[0]!.id, {
          versao: 1,
          decisao: 'impugnar',
          motivo: null,
          justificativa: null,
        }),
      );
      await decidir(1, fr.itens[0]!.id, 'aceitar', null);
      await decidir(2, fr.itens[1]!.id, 'impugnar', 'naoBeneficiario');
      const txR = await servico.conferirTransmissao(c, res.id, { versao: 3 });
      await gravar('operadora.transmitirEnvioAns', (g) =>
        g.transmitir({
          id: res.id,
          versao: 3,
          recibo: txR.recibo,
          arquivo: txR.arquivo,
          texto: txR.texto,
          usuario: USUARIO,
        }),
      );
      const fr2 = await servico.detalhe(c, res.id);

      const t1 = performance.now();
      const lista = await servico.lista(c, { operadora: ope });
      const ms = performance.now() - t1;
      const escritas = (await escritasDaTransacao(e)).map((w) => w.tabela).sort();
      return {
        aberta: codigos(aberta.problemas),
        sem: { podeGerar: sem.podeGerar, codigos: codigos(sem.problemas) },
        msPrevia,
        pend: pend.itens.map((p) => p.beneficiario).sort((a, b) => a - b),
        ct,
        velhaComp,
        previa,
        fichaSib,
        arqNome: arq.nome,
        hashConfere,
        comRecibo,
        aguardando: codigos(aguardando.problemas),
        velhaRet,
        retorno: rt.situacao,
        aceitoTit,
        nada: codigos(nada.problemas),
        gruNoSib,
        tpsPrevia,
        gruAntes,
        fichaTps,
        valorTps,
        d0: codigos(d0.problemas),
        d1: codigos(d1.problemas),
        d2: d2.podeGerar,
        fr,
        repetido,
        pendente,
        semMotivo,
        fr2,
        lista: lista.itens.map((x) => x.obrigacao).sort(),
        totais: lista.totais,
        ms,
        escritas,
        trilhas: await contar(e),
        titular: k.titular.id,
        dependente: k.dependente,
      };
    });
    expect(r.aberta).toEqual(['competencia-futura']);
    expect(r.sem.podeGerar).toBe(false);
    expect(r.sem.codigos).toEqual(expect.arrayContaining(['sem-endereco']));
    expect(r.pend).toEqual([r.titular, r.dependente].sort((a, b) => a - b));
    expect(r.ct).toMatchObject({ versao: 1, municipio: 4205407, cco: null, aceitoEm: null });
    expect(r.velhaComp).toBe('envio-desatualizado');
    expect(r.previa).toMatchObject({ podeGerar: true, registros: 2, destino: 'simulador' });
    expect(r.fichaSib).toMatchObject({ obrigacao: 'SIB', situacao: 'gerado', sequencial: 1, registros: 2 });
    expect(r.fichaSib.itens.map((i) => i.tipo)).toEqual(['inclusao', 'inclusao']);
    expect(r.arqNome).toBe('SIB_990567_202609_001.xml');
    expect(r.hashConfere).toBe(true);
    expect(r.comRecibo).toBe('recibo-no-simulador');
    expect(r.aguardando).toEqual(['aguardando-retorno']);
    expect(r.velhaRet).toBe('envio-desatualizado');
    expect(r.retorno).toBe('aceito');
    expect(r.aceitoTit.cco).toMatch(/^99\d{10}$/);
    expect(r.aceitoTit.aceitoEm).not.toBeNull();
    expect(r.nada).toEqual(['sem-movimentos']);
    expect(r.gruNoSib).toBe('sem-gru');
    expect(r.tpsPrevia.podeGerar).toBe(true);
    expect(r.tpsPrevia.quadros[0]!.parcelas[0]!.rotulo).toContain('(2 + 2 + 2 ÷ 3)');
    expect(r.gruAntes).toBe('gru-antes-do-aceite');
    expect(r.fichaTps).toMatchObject({ situacao: 'aceito', gru: '12345678901234', valorPago: r.valorTps });
    expect(r.d0).toEqual(['sem-balancete']);
    expect(r.d1).toEqual(['balancete-desequilibrado']);
    expect(r.d2).toBe(true);
    expect(r.fr).toMatchObject({ obrigacao: 'RESSARCIMENTO_SUS', acoes: ['decidir'], hash: null });
    expect(r.fr.itens[1]!.sugestao).toBe('naoBeneficiario');
    expect(r.repetido).toBe('aviso-repetido');
    expect(r.pendente).toBe('decisao-pendente');
    expect(r.semMotivo).toBe('impugnacao-sem-motivo');
    expect(r.fr2.situacao).toBe('enviado');
    expect(r.fr2.itens.map((i) => i.decisao)).toEqual(['aceitar', 'impugnar']);
    expect(r.fr2.eventos.map((x) => x.evento)).toEqual(['geracao', 'decisao', 'decisao', 'protocolo']);
    expect(r.lista).toEqual(['RESSARCIMENTO_SUS', 'SIB', 'TPS']);
    expect(r.ms).toBeLessThan(300);
    // Seção 5: só tabelas SGH_ (as da F1 da carteira sintética, as da F6 e a trilha) na transação.
    expect(r.escritas.every((t) => t.startsWith('SGH_') || t.startsWith('RDB$'))).toBe(true);
    expect(r.escritas).toEqual(
      expect.arrayContaining([
        'SGH_OPE_ENVIO_ANS',
        'SGH_OPE_ENVIO_ANS_ITEM',
        'SGH_OPE_ENVIO_ANS_EVT',
        'SGH_OPE_BENEF_SIB',
        'SGH_TRILHA',
      ]),
    );
    // Uma linha de trilha por gravação da F6: 2 complementos; SIB gerado, enviado e com retorno; TPS gerada, enviada,
    // com retorno e paga; o aviso, 2 decisões e o protocolo (as recusas não gravam).
    expect(r.trilhas - antes.trilhas).toBe(13);
    const depois = await retrato();
    expect(depois).toEqual(antes);
    console.log(
      `[int-m56-7] ${COD}: ciclo F6 desfeito (prévia do SIB em ${Math.round(r.msPrevia)} ms; SIB de ${r.previa.registros} inclusões gerado, enviado ao simulador e aceito com o CCO; TPS de R$ ${r.valorTps} com a GRU; DIOPS conferido; aviso de ressarcimento com 2 atendimentos decididos e a impugnação protocolada); recusas ${[r.velhaComp, r.comRecibo, r.velhaRet, r.gruNoSib, r.gruAntes, r.repetido, r.pendente, r.semMotivo].join(', ')}; lista em ${Math.round(r.ms)} ms; escritas só em SGH_ (${r.escritas.length} tabelas); trilha ${r.trilhas - antes.trilhas}; ROLLBACK igual (${antes.envios} envios)`,
    );
  });
});
