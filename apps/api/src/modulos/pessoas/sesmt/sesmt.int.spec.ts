// Integração da porta PRÓPRIA do SESMT (F2.2, lote 03-10) contra o MariaDB do cliente de teste da onda 3 (f22_o3), com
// massa SINTÉTICA: o contrato de efeito de cada gravação (as linhas, a versão e a trilha com o motivo e a correção) e as
// recusas (vínculo de outro estabelecimento, versão desatualizada, EPI fora do cadastro), mais a leitura do dosímetro,
// que aguarda o contrato endereçar o registro pelo tipo (recusa 409, nunca silêncio). Cada gravação confere a linha da trilha (ação, entidade e
// entidade_id) e a versão; a hora do acidente perto da meia-noite prova o fuso do estabelecimento; o mapa de riscos usa
// um fator semeado e dois ambientes (o do setor da função, o ambíguo e o inexistente).
import { chaveFuncao } from '@sgh/dominio-pessoas';
import { ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../../exames/public-api.js';
import type { ContextoSesmt } from './porta-sesmt.js';
import { DADOS_CAT_VAZIOS } from './porta-sesmt.js';
import { PortaSesmtPropria } from './porta-sesmt-propria.js';
import {
  CLIENTE_O3,
  ctxSesmt,
  encerrarMassaSesmt,
  type MassaSesmt,
  prepararMassaSesmt,
  SEM_BANCO_O3,
} from './massa-sesmt.spec-util.js';

/** A linha da trilha da gravação: o alvo é o registro (o id dado ou o que a gravação devolveu). */
const trilha =
  (entidade: string, id: number | null = null) =>
  (r: unknown): TrilhaDaGravacao => ({
    estabelecimento: null,
    usuario: null,
    acao: 'operacao',
    entidade,
    // A linha de EPI da função volta com o id negativo (a tela distingue do risco): a trilha leva o id da linha.
    entidadeId: id ?? (typeof r === 'number' ? Math.abs(r) : null),
    dadosDepois: { evento: 'teste' },
    correlacao: 'teste-l0310',
  });
const FATOR = 'L0310.01';
const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroOperacao
      ? String(e.problema.codigo)
      : String((e as { codigo?: string }).codigo ?? e);
  }
};

describe.skipIf(SEM_BANCO_O3)('porta própria do SESMT contra o MariaDB (f22_o3)', () => {
  let m: MassaSesmt;
  let porta: PortaSesmtPropria;
  let c: ContextoSesmt;
  let fora: ContextoSesmt;
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: CLIENTE_O3, correlacao: 't' }, (l) => l.consultar<T>(sql, p));

  /** A última linha da trilha do estabelecimento (a da gravação que acabou de rodar). */
  const ultimaTrilha = async () =>
    (
      await ler<{ acao: string; entidade: string; entidade_id: number | null; motivo: string | null }>(
        'SELECT acao, entidade, entidade_id, motivo FROM trilha_auditoria WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 1',
        [m.est],
      )
    )[0];
  const conferirTrilha = async (entidade: string, id: number) => {
    const t = await ultimaTrilha();
    expect([t?.acao, t?.entidade, Number(t?.entidade_id)]).toEqual(['operacao', entidade, id]);
    return t;
  };

  beforeAll(async () => {
    m = await prepararMassaSesmt('S');
    porta = new PortaSesmtPropria(m.nucleo);
    c = ctxSesmt(m.est, m.usuario);
    fora = ctxSesmt(m.outro, m.usuario);
  }, 60_000);
  afterAll(() => encerrarMassaSesmt(m));

  it('relógio e domínios: datas no fuso, listas fixas e o cadastro de vacinas', async () => {
    const r = await porta.relogio(c);
    expect(r.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.agora).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const d = await porta.dominios(c);
    expect(d.conclusoesAso.map((x) => x.codigo)).toEqual([1, 2]);
    expect(d.tiposAso.map((x) => x.codigo)).toContain(0);
    expect(d.dosesVacinaCadastro.length).toBeGreaterThan(0);
  });

  it('ASO: a linha com o número da sequência, o exame e a retificação que tira o anterior da lista', async () => {
    const id = await porta.gravarSgh(c, trilha('aso'), (g) =>
      g.incluirAso({
        vinculo: m.vinculo,
        tipo: 0,
        data: '2026-01-05',
        conclusao: 1,
        restricoes: null,
        medico: 'MEDICO SINTETICO',
        medicoConselho: '123',
        proximo: '2027-01-05',
        observacao: null,
        retifica: null,
        motivoRetificacao: null,
        por: m.login,
      }),
    );
    const [l] = await ler<{ numero: string; tipo: string; conclusao: string; versao: number }>(
      'SELECT numero, tipo, conclusao, versao FROM aso WHERE id = ?',
      [id],
    );
    expect(l).toMatchObject({ tipo: 'admissional', conclusao: 'apto', versao: 1 });
    expect(String(l?.numero)).toMatch(/^ASO-\d+$/);
    await conferirTrilha('aso', id);
    const exame = await porta.gravarSgh(c, trilha('exame_ocupacional'), (g) =>
      g.incluirExame({
        vinculo: m.vinculo,
        aso: id,
        exame: 'Hemograma',
        data: '2026-01-05',
        resultado: 'normal',
        por: m.login,
      }),
    );
    const novo = await porta.gravarSgh(c, trilha('aso'), (g) =>
      g.incluirAso({
        vinculo: m.vinculo,
        tipo: 0,
        data: '2026-01-06',
        conclusao: 1,
        restricoes: null,
        medico: 'MEDICO SINTETICO',
        medicoConselho: null,
        proximo: null,
        observacao: null,
        retifica: id,
        motivoRetificacao: 'data errada',
        por: m.login,
      }),
    );
    const oc = await porta.ocupacional(c, m.vinculo);
    expect(oc.filter((x) => x.registro === 'aso').map((x) => x.id)).toEqual([novo]);
    // O exame do ASO retificado continua no prontuário, ligado ao ASO novo, com a versão relevada.
    expect(oc.filter((x) => x.registro === 'exame').map((x) => [x.id, x.aso])).toEqual([[exame, novo]]);
    const [ve] = await ler<{ versao: number }>('SELECT versao FROM exame_ocupacional WHERE id = ?', [exame]);
    expect(Number(ve?.versao)).toBe(2);
    expect((await conferirTrilha('aso', novo))?.motivo).toContain('religado');
    const [ex] = await ler<{ excluido_por: number }>('SELECT excluido_por FROM aso WHERE id = ?', [id]);
    expect(Number(ex?.excluido_por)).toBe(m.usuario);
    const [t] = await ler<{ motivo: string }>(
      "SELECT motivo FROM trilha_auditoria WHERE estabelecimento_id = ? AND motivo LIKE '%data errada%' ORDER BY id DESC LIMIT 1",
      [m.est],
    );
    expect(t?.motivo).toContain('retificação de aso');
    expect(await porta.ocupacional(fora, m.vinculo)).toEqual([]);
  });

  it('recusas: vínculo de outro estabelecimento, anti-HBs e dosimetria sem modelo', async () => {
    expect(
      await codigo(
        porta.gravarSgh(fora, trilha('aso'), (g) =>
          g.incluirAso({
            vinculo: m.vinculo,
            tipo: 0,
            data: '2026-01-05',
            conclusao: 1,
            restricoes: null,
            medico: 'X',
            medicoConselho: null,
            proximo: null,
            observacao: null,
            retifica: null,
            motivoRetificacao: null,
            por: m.login,
          }),
        ),
      ),
    ).toBe('nao-encontrado');
    expect(
      await codigo(
        porta.gravarSgh(c, trilha('vacina_colaborador'), (g) =>
          g.incluirVacina({
            vinculo: m.vinculo,
            registro: 'anti-hbs',
            vacina: 'hepatite-b',
            codigoVacina: null,
            dose: null,
            codigoDose: null,
            data: '2026-02-01',
            lote: null,
            validadeLote: null,
            antiHbs: 50,
            observacao: null,
            retifica: null,
            motivoRetificacao: null,
            por: m.login,
          }),
        ),
      ),
    ).toBe('ok');
    expect((await porta.vacinas(c, m.vinculo)).find((x) => x.registro === 'anti-hbs')).toMatchObject({
      antiHbs: 50,
      dose: null,
    });
    expect(
      await codigo(
        porta.gravarSgh(c, trilha('entrega_epi'), (g) =>
          g.incluirRegistroEpi({
            vinculo: m.vinculo,
            tipo: 'dosimetria',
            data: '2026-02-01',
            epi: null,
            caNumero: null,
            caValidade: null,
            quantidade: null,
            periodoInicio: '2026-01-01',
            doseMsv: 0.1,
            dosimetro: 'D1',
            agente: null,
            duracaoMin: null,
            observacao: null,
            por: m.login,
          }),
        ),
      ),
    ).toBe('modelo-pendente');
  });

  it('vacina: a dose do colaborador com a sequência e o cadastro da vacina garantido', async () => {
    const id = await porta.gravarSgh(c, trilha('vacina_colaborador'), (g) =>
      g.incluirVacina({
        vinculo: m.vinculo,
        registro: 'dose',
        vacina: 'hepatite-b',
        codigoVacina: null,
        dose: '1',
        codigoDose: null,
        data: '2026-02-01',
        lote: 'L1',
        validadeLote: '2027-01-01',
        antiHbs: null,
        observacao: null,
        retifica: null,
        motivoRetificacao: null,
        por: m.login,
      }),
    );
    const vs = await porta.vacinas(c, m.vinculo);
    expect(vs.find((v) => v.id === id)).toMatchObject({
      registro: 'dose',
      vacina: 'hepatite-b',
      dose: '1',
      data: '2026-02-01',
      lote: 'L1',
    });
    const [l] = await ler<{ dose: string; numero_dose: number }>(
      'SELECT dose, numero_dose FROM vacina_colaborador WHERE id = ?',
      [id],
    );
    expect(l).toMatchObject({ dose: 'primeira', numero_dose: 1 });
  });

  it('acidente típico: a comunicação, a CAT emitida, a retificação com a correção na trilha, a versão e a anulação', async () => {
    const id = await porta.gravarSgh(c, trilha('comunicacao_acidente'), (g) =>
      g.incluirAcidente({
        vinculo: m.vinculo,
        ocorridoEm: '2026-03-02T10:30',
        tipo: 'tipico',
        unidade: null,
        local: 'Posto 2',
        descricao: 'Queda sintética',
        biologico: false,
        perfurocortante: false,
        exposicao: null,
        material: null,
        fonte: null,
        fonteTeste: null,
        parteCorpo: null,
        natureza: null,
        agente: null,
        situacao: null,
        afastamento: false,
        obito: false,
        profilaxia: 'nao-indicada',
        profilaxiaEm: null,
        profilaxiaObs: null,
        catPrazo: '2026-03-03',
        por: m.login,
      }),
    );
    let a = await porta.acidente(c, id);
    expect(a).toMatchObject({
      vinculo: m.vinculo,
      ocorridoEm: '2026-03-02T10:30',
      tipo: 'tipico',
      biologico: false,
      estado: 'aberto',
      tipoCat: null,
      versao: 1,
    });
    await conferirTrilha('comunicacao_acidente', id);
    expect(a?.catPrazo).toMatch(/^2026-03-0\d$/);
    await porta.gravarSgh(c, trilha('comunicacao_acidente', id), (g) =>
      g.emitirCat({
        id,
        versao: 1,
        tipoCat: 1,
        iniciativa: 1,
        numero: 'REC-1',
        emitidaEm: '2026-03-02',
        por: m.login,
      }),
    );
    a = await porta.acidente(c, id);
    expect(a).toMatchObject({
      tipoCat: 1,
      iniciativaCat: 1,
      catNumero: 'REC-1',
      catEmitidaEm: '2026-03-02',
      catEmitidaPor: m.login,
      versao: 2,
    });
    expect(
      await codigo(
        porta.gravarSgh(c, trilha('comunicacao_acidente'), (g) =>
          g.retificarAcidente({
            id,
            versao: 1,
            ocorridoEm: '2026-03-02T11:00',
            tipo: 'tipico',
            local: 'Posto 3',
            descricao: 'x',
            parteCorpo: null,
            natureza: null,
            agente: null,
            situacao: null,
            afastamento: false,
            obito: false,
            catPrazo: '2026-03-03',
            cat: DADOS_CAT_VAZIOS,
            por: m.login,
          }),
        ),
      ),
    ).toBe('conflito-versao');
    await porta.gravarSgh(c, trilha('comunicacao_acidente', id), async (g) => {
      await g.retificarAcidente({
        id,
        versao: 2,
        ocorridoEm: '2026-03-02T11:00',
        tipo: 'tipico',
        local: 'Posto 3',
        descricao: 'Queda sintética',
        parteCorpo: null,
        natureza: null,
        agente: null,
        situacao: null,
        afastamento: true,
        obito: false,
        catPrazo: '2026-03-03',
        cat: { ...DADOS_CAT_VAZIOS, horasAntes: '02:30', lateralidade: 1 },
        por: m.login,
      });
      await g.registrarCorrecao({
        tabela: 'comunicacao_acidente',
        registro: id,
        operacao: 'retificacao',
        antes: { local: 'Posto 2' },
        depois: { local: 'Posto 3' },
        motivo: 'local corrigido',
        por: m.login,
      });
    });
    a = await porta.acidente(c, id);
    expect(a).toMatchObject({ local: 'Posto 3', afastamento: true, versao: 3 });
    expect(a?.cat).toMatchObject({ horasAntes: '02:30', lateralidade: 1 });
    const cs = await porta.correcoes(c, 'comunicacao_acidente', [id]);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({
      registro: id,
      antes: { local: 'Posto 2' },
      depois: { local: 'Posto 3' },
      por: m.login,
    });
    expect(cs[0]?.motivo).toContain('local corrigido');
    expect((await conferirTrilha('comunicacao_acidente', id))?.motivo).toContain('local corrigido');
    // O acidente sem material biológico também se encerra (na comunicação, com quem e o motivo).
    await porta.gravarSgh(c, trilha('comunicacao_acidente', id), (g) =>
      g.encerrarAcidente({ id, versao: 3, motivo: 'fim', por: m.login }),
    );
    a = await porta.acidente(c, id);
    expect(a).toMatchObject({
      estado: 'encerrado',
      encerradoPor: m.login,
      motivoEncerramento: 'fim',
      versao: 4,
    });
    expect(
      await codigo(
        porta.gravarSgh(c, trilha('comunicacao_acidente'), (g) =>
          g.encerrarAcidente({ id, versao: 4, motivo: 'de novo', por: m.login }),
        ),
      ),
    ).toBe('acidente-encerrado');
    await porta.gravarSgh(c, trilha('comunicacao_acidente', id), (g) =>
      g.anularAcidente({ id, versao: 4, motivo: 'lançado em duplicidade', por: m.login }),
    );
    a = await porta.acidente(c, id);
    expect(a).toMatchObject({ anuladoPor: m.login, versao: 5 });
    expect((await conferirTrilha('comunicacao_acidente', id))?.motivo).toContain('anulação');
    expect(
      (await porta.listarAcidentes(c, { estado: 'todos', vinculo: m.vinculo, limite: 10 })).itens.map(
        (x) => x.id,
      ),
    ).toContain(id);
    expect(await porta.acidente(fora, id)).toBeNull();
  });

  it('fuso do estabelecimento: a hora civil perto da meia-noite vai em UTC ao banco e volta igual à tela', async () => {
    await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 't' }, (e) =>
      e.executar("UPDATE estabelecimento SET fuso_horario = 'America/Sao_Paulo' WHERE id = ?", [m.est]),
    );
    const id = await porta.gravarSgh(c, trilha('comunicacao_acidente'), (g) =>
      g.incluirAcidente({
        vinculo: m.vinculo,
        ocorridoEm: '2026-05-04T23:30',
        tipo: 'trajeto',
        unidade: null,
        local: 'Saída',
        descricao: 'Acidente sintético à noite',
        biologico: false,
        perfurocortante: false,
        exposicao: null,
        material: null,
        fonte: null,
        fonteTeste: null,
        parteCorpo: null,
        natureza: null,
        agente: null,
        situacao: null,
        afastamento: false,
        obito: false,
        profilaxia: 'nao-indicada',
        profilaxiaEm: null,
        profilaxiaObs: null,
        catPrazo: '2026-05-05',
        por: m.login,
      }),
    );
    const [b] = await ler<{ em: string }>(
      "SELECT DATE_FORMAT(acidente_em, '%Y-%m-%d %H:%i') AS em FROM comunicacao_acidente WHERE id = ?",
      [id],
    );
    expect(b?.em).toBe('2026-05-05 02:30');
    await porta.gravarSgh(c, trilha('comunicacao_acidente', id), (g) =>
      g.emitirCat({
        id,
        versao: 1,
        tipoCat: 1,
        iniciativa: 1,
        numero: 'REC-N',
        emitidaEm: '2026-05-04T22:10',
        por: m.login,
      }),
    );
    const a = await porta.acidente(c, id);
    expect(a).toMatchObject({ ocorridoEm: '2026-05-04T23:30', catEmitidaEm: '2026-05-04', versao: 2 });
    const [e] = await ler<{ em: string }>(
      "SELECT DATE_FORMAT(emitida_em, '%Y-%m-%d %H:%i') AS em FROM comunicacao_acidente WHERE id = ?",
      [id],
    );
    expect(e?.em).toBe('2026-05-05 01:10');
  });

  it('acidente com material biológico: a exposição, a profilaxia, o acompanhamento e o encerramento pela alta', async () => {
    const id = await porta.gravarSgh(c, trilha('comunicacao_acidente'), (g) =>
      g.incluirAcidente({
        vinculo: m.vinculo,
        ocorridoEm: '2026-04-01T08:00',
        tipo: 'tipico',
        unidade: null,
        local: 'UTI',
        descricao: 'Picada de agulha sintética',
        biologico: true,
        perfurocortante: true,
        exposicao: 'percutanea',
        material: 'sangue',
        fonte: 'conhecida',
        fonteTeste: 'nao-reagente',
        parteCorpo: null,
        natureza: null,
        agente: null,
        situacao: null,
        afastamento: false,
        obito: false,
        profilaxia: 'indicada',
        profilaxiaEm: null,
        profilaxiaObs: null,
        catPrazo: '2026-04-02',
        por: m.login,
      }),
    );
    let a = await porta.acidente(c, id);
    expect(a).toMatchObject({
      biologico: true,
      perfurocortante: true,
      exposicao: 'percutanea',
      material: 'sangue',
      fonte: 'conhecida',
      fonteTeste: 'nao-reagente',
      profilaxia: 'indicada',
    });
    await porta.gravarSgh(c, trilha('exposicao_biologica'), (g) =>
      g.atualizarProfilaxia({
        id,
        versao: 1,
        profilaxia: 'iniciada',
        profilaxiaEm: '2026-04-01',
        observacao: null,
        por: m.login,
      }),
    );
    a = await porta.acidente(c, id);
    expect(a).toMatchObject({ profilaxia: 'iniciada', profilaxiaEm: '2026-04-01', versao: 2 });
    // O acompanhamento sorológico: o marco grava e é lido.
    const s = await codigo(
      porta.gravarSgh(c, trilha('sorologia_exposicao'), (g) =>
        g.incluirSorologia({ acidente: id, marco: 'd0', prevista: '2026-04-01' }),
      ),
    );
    expect(s).toBe('ok');
    expect((await porta.sorologias(c, [id])).map((x) => x.marco)).toEqual(['d0']);
    await porta.gravarSgh(c, trilha('comunicacao_acidente', id), (g) =>
      g.encerrarAcidente({ id, versao: 2, motivo: 'alta do acompanhamento', por: m.login }),
    );
    a = await porta.acidente(c, id);
    expect(a).toMatchObject({ estado: 'encerrado', versao: 3 });
    expect(a?.encerradoEm).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await conferirTrilha('comunicacao_acidente', id))?.motivo).toContain('alta do acompanhamento');
    expect(
      (await porta.listarAcidentes(c, { estado: 'encerrado', limite: 10 })).itens.map((x) => x.id),
    ).toContain(id);
  });

  it('EPI: a entrega com o CA do cadastro, a assinatura e o cancelamento; EPI fora do cadastro é recusado', async () => {
    const id = await porta.gravarSgh(c, trilha('entrega_epi'), (g) =>
      g.incluirRegistroEpi({
        vinculo: m.vinculo,
        tipo: 'epi',
        data: '2026-02-10',
        epi: m.epi,
        caNumero: null,
        caValidade: null,
        quantidade: 2,
        periodoInicio: null,
        doseMsv: null,
        dosimetro: null,
        agente: null,
        duracaoMin: null,
        observacao: null,
        por: m.login,
      }),
    );
    let r = await porta.registroEpi(c, id);
    expect(r).toMatchObject({
      tipo: 'epi',
      epi: m.epi,
      caNumero: '12345',
      caValidade: '2099-12-31',
      quantidade: 2,
      assinatura: 'pendente',
    });
    await porta.gravarSgh(c, trilha('entrega_epi', id), (g) => g.assinarEntregaEpi({ id, por: m.login }));
    r = await porta.registroEpi(c, id);
    expect(r?.assinatura).toBe('assinada');
    await conferirTrilha('entrega_epi', id);
    const [ve] = await ler<{ versao: number }>('SELECT versao FROM entrega_epi WHERE id = ?', [id]);
    expect(Number(ve?.versao)).toBe(2);
    await porta.gravarSgh(c, trilha('entrega_epi', id), (g) =>
      g.cancelarEntregaEpi({ id, motivo: 'entregue ao colaborador errado', por: m.login }),
    );
    await conferirTrilha('entrega_epi', id);
    r = await porta.registroEpi(c, id);
    expect(r).toMatchObject({ motivoCancelamento: 'entregue ao colaborador errado', canceladoPor: m.login });
    expect((await porta.registrosEpi(c, m.vinculo)).length).toBeGreaterThan(0);
    expect(
      await codigo(
        porta.gravarSgh(c, trilha('entrega_epi'), (g) =>
          g.incluirRegistroEpi({
            vinculo: m.vinculo,
            tipo: 'epi',
            data: '2026-02-10',
            epi: 'EPI INEXISTENTE',
            caNumero: null,
            caValidade: null,
            quantidade: 1,
            periodoInicio: null,
            doseMsv: null,
            dosimetro: null,
            agente: null,
            duracaoMin: null,
            observacao: null,
            por: m.login,
          }),
        ),
      ),
    ).toBe('epi-nao-cadastrado');
  });

  it('mapa de riscos: o EPI exigido da função e o fim da vigência; o painel lê o vínculo ativo', async () => {
    const chave = chaveFuncao(m.funcao);
    const id = await porta.gravarSgh(c, trilha('epi_funcao'), (g) =>
      g.incluirLinhaRisco({
        unidade: null,
        setor: null,
        funcao: m.funcao,
        funcaoChave: chave,
        tipo: 'epi',
        fatorRisco: null,
        grupoRisco: null,
        epc: null,
        epi: m.epi,
        descricao: null,
        inicio: '2026-01-01',
        por: m.login,
      }),
    );
    let mapa = await porta.mapaRiscos(c, { funcaoChave: chave, vigentes: true });
    expect(mapa.find((x) => x.id === id)).toMatchObject({ tipo: 'epi', epi: m.epi, funcaoChave: chave });
    await porta.gravarSgh(c, trilha('epi_funcao'), (g) =>
      g.encerrarLinhaRisco({ id, fim: '2026-01-31', motivo: 'troca de modelo', por: m.login }),
    );
    mapa = await porta.mapaRiscos(c, { funcaoChave: chave, vigentes: false });
    expect(mapa.find((x) => x.id === id)?.fim).toBe('2026-01-31');
    // Massa do mapa: um fator semeado, o ambiente A (sem setor, da massa) e o ambiente B (do setor S).
    const { setor, ambienteB } = await m.nucleo.escrever(
      { cliente: CLIENTE_O3, correlacao: 't' },
      async (e) => {
        const agora = new Date();
        const um = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
          const l = await e.uma<{ id: number }>(sel, p);
          return l ? Number(l.id) : e.inserir(ins, pi);
        };
        await um(
          'SELECT id FROM fator_risco_ocupacional WHERE codigo_esocial = ?',
          [FATOR],
          "INSERT INTO fator_risco_ocupacional (codigo_esocial, descricao, grupo, criado_em) VALUES (?, 'Fator sintético do teste', 'fisico', ?)",
          [FATOR, agora],
        );
        const st = await um(
          'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
          [m.est, 'L0310S'],
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, 'L0310S', 'SETOR SINTETICO L0310', 'assistencial', ?)",
          [m.est, agora],
        );
        const b = await um(
          'SELECT id FROM ambiente_trabalho WHERE estabelecimento_id = ? AND codigo = ?',
          [m.est, 'L0310B'],
          "INSERT INTO ambiente_trabalho (estabelecimento_id, codigo, nome, descricao, tipo_local, data_inicio, setor_funcional_id, criado_em) VALUES (?, 'L0310B', 'AMBIENTE SINTETICO B', 'Ambiente do setor sintético', 'estabelecimento_proprio', '2020-01-01', ?, ?)",
          [m.est, st, agora],
        );
        await e.executar(
          'UPDATE funcao SET setor_funcional_id = NULL WHERE estabelecimento_id = ? AND nome = ?',
          [m.est, m.funcao],
        );
        return { setor: st, ambienteB: b };
      },
    );
    const risco = (setorTela: string | null) =>
      porta.gravarSgh(c, trilha('risco_funcao'), (g) =>
        g.incluirLinhaRisco({
          unidade: null,
          setor: setorTela,
          funcao: m.funcao,
          funcaoChave: chave,
          tipo: 'risco',
          fatorRisco: FATOR,
          grupoRisco: null,
          epc: 2,
          epi: null,
          descricao: 'EPC sintético',
          inicio: '2026-01-01',
          por: m.login,
        }),
      );
    // Função sem setor e dois ambientes: recusa, nunca um ambiente qualquer.
    expect(await codigo(risco(null))).toBe('ambiente-ambiguo');
    expect(await codigo(risco('SETOR QUE NAO EXISTE'))).toBe('ambiente-inexistente');
    try {
      await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 't' }, (e) =>
        e.executar('UPDATE funcao SET setor_funcional_id = ? WHERE estabelecimento_id = ? AND nome = ?', [
          setor,
          m.est,
          m.funcao,
        ]),
      );
      const rid = await risco(null);
      const [g] = await ler<{ ambiente_trabalho_id: number; versao: number }>(
        'SELECT ambiente_trabalho_id, versao FROM risco_funcao WHERE id = ?',
        [rid],
      );
      expect([Number(g?.ambiente_trabalho_id), Number(g?.versao)]).toEqual([ambienteB, 1]);
      await conferirTrilha('risco_funcao', rid);
      mapa = await porta.mapaRiscos(c, { funcaoChave: chave, vigentes: true });
      expect(mapa.find((x) => x.id === rid)).toMatchObject({
        tipo: 'risco',
        setor: 'SETOR SINTETICO L0310',
        fatorRisco: FATOR,
      });
    } finally {
      await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 't' }, (e) =>
        e.executar('UPDATE funcao SET setor_funcional_id = NULL WHERE estabelecimento_id = ? AND nome = ?', [
          m.est,
          m.funcao,
        ]),
      );
    }
    const resumo = await porta.resumo(c, 2026);
    expect(resumo.vinculos.map((v) => v.id)).toContain(m.vinculo);
    expect(resumo.vinculos.map((v) => v.id)).not.toContain(m.vinculoOutro);
  });
});
