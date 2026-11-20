// W0-08, parte 8 (mercado M2): o alerta de tecnovigilância e recall (SGH_MAN_ALERTA, SGH_MAN_ALERTA_EQUIP e
// SGH_MAN_OS_QUEIXA, script 1106) na cópia de dev, numa transação SEMPRE desfeita, com dados SINTÉTICOS (setor fora de
// qualquer real, fabricante inventado): o alerta com a faixa de série encontra os equipamentos do parque (o de fora da
// faixa e o desativado ficam fora; o sem série fica a conferir); gera uma OS de ação de campo por equipamento (de novo:
// sem-afetados); o critério travado depois da OS; a OS abre a queixa técnica na vigilância de produto da qualidade
// (SGH_QUA_TECNOVIG, com a série, o fabricante e o número do alerta; a segunda recusada); a exclusão do alerta com OS
// recusada com a contagem e a oferta do encerramento; o alerta sem vínculo excluído com o retrato; o encerramento com
// motivo. Só tabelas SGH_.
import {
  afetadosDoAlerta,
  conferirAlteracaoAlerta,
  descricaoDaAcaoDeCampo,
  faixaInvertida,
  planejarAcaoDeCampo,
} from '@sgh/dominio-manutencao';
import {
  abrirQueixaDaOsSgh,
  alterarAlertaEquipamentoSgh,
  type CamposAlertaParaGravar,
  encerrarAlertaEquipamentoSgh,
  ErroOperacao,
  type Escritor,
  escritasDaTransacao,
  excluirAlertaEquipamentoSgh,
  gerarAcaoDeCampoSgh,
  incluirAlertaEquipamentoSgh,
  incluirEquipamentoSgh,
  type Leitor,
  lerAcoesDoAlerta,
  lerAlertaEquipamento,
  lerParqueDoAlerta,
  lerVinculosTecnovigDaOs,
  relogioManutencao,
  somenteSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';

const USUARIO = 'SGH.TESTE.W008';
const SETOR = 2_000_110_601;
const FABRICANTE = 'Fabricante Sintético W008 Ltda';

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (x) {
    if (x instanceof ErroOperacao) return x.problema.codigo ?? 'sem-codigo';
    return String(x);
  }
}

const retrato = async (l: Leitor) => {
  const r: Record<string, string> = {};
  for (const t of [
    'SGH_MAN_ALERTA',
    'SGH_MAN_ALERTA_EQUIP',
    'SGH_MAN_OS_QUEIXA',
    'SGH_MAN_OS',
    'SGH_MAN_EQUIPAMENTO',
    'SGH_QUA_TECNOVIG',
    'SGH_HIST_EXCLUSAO',
  ]) {
    const [x] = await l.consultar(`SELECT COUNT(*) N, MAX(ID) M FROM ${t}`, [], { teto: 1 });
    r[t] = `${String(x?.['N'])}/${String(x?.['M'])}`;
  }
  return JSON.stringify(r);
};

const alertaBase: CamposAlertaParaGravar = {
  numero: 'W008-ALERTA-1',
  tipo: 'recall',
  titulo: 'Falha no sensor de oclusão (teste)',
  fabricante: FABRICANTE.toUpperCase(),
  modelo: 'bi-200',
  serieInicio: 'SN-900',
  serieFim: 'SN-1200',
  registroAnvisa: null,
  publicadoEm: null,
  descricao: 'O sensor de oclusão pode não alarmar (dado sintético).',
  acao: 'Trocar a placa do sensor de oclusão conforme o boletim do fabricante.',
};

const planejar =
  (pedidos: readonly number[] = []) =>
  (
    alerta: Parameters<Parameters<typeof gerarAcaoDeCampoSgh>[1]['planejar']>[0],
    parque: Parameters<Parameters<typeof gerarAcaoDeCampoSgh>[1]['planejar']>[1],
    acoes: Parameters<Parameters<typeof gerarAcaoDeCampoSgh>[1]['planejar']>[2],
  ) => {
    const lista = afetadosDoAlerta(parque, alerta, acoes);
    const p = planejarAcaoDeCampo(alerta, alerta.versao, lista, pedidos);
    if (!p.ok) return p;
    return {
      ok: true as const,
      equipamentos: p.equipamentos.map((q) => ({
        equipamento: q.equipamento,
        centroCusto: q.centroCusto,
        descricao: descricaoDaAcaoDeCampo(alerta, q),
      })),
    };
  };

describe.skipIf(!PODE_ESCREVER)('alerta de tecnovigilância na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('faixa de série, uma OS por afetado, queixa técnica da OS, recusa de órfão e encerramento; ROLLBACK', async () => {
    const ctx = { ...a.c, traceId: 'int-w008-alerta' };
    const antes = await a.nucleo.lerSomente(ctx, retrato);
    const r = await a.nucleo.desfazendoNaCopia(ctx, async (e0) => {
      const e: Escritor = somenteSgh(e0);
      const { agora } = await relogioManutencao(e);
      const equip = (
        codigo: string,
        serie: string | null,
        extra: { modelo?: string; situacao?: 'desativado' } = {},
      ) =>
        incluirEquipamentoSgh(e, {
          codigo,
          nome: `BOMBA SINTETICA ${codigo}`,
          tipo: 'medico',
          criticidade: 'alta',
          classeRisco: 'III',
          fabricante: FABRICANTE,
          modelo: extra.modelo ?? 'BI-200',
          numeroSerie: serie,
          registroAnvisa: '80000000001',
          unidade: null,
          centroCusto: SETOR,
          localizacao: null,
          recurso: null,
          bemPatrimonial: null,
          instalacao: null,
          garantiaAte: null,
          situacao: extra.situacao ?? 'ativo',
          motivo: extra.situacao ? 'Desativado no teste' : null,
          usuario: USUARIO,
        });
      const q1 = await equip('W008-TV-1', 'SN-0950');
      const q2 = await equip('W008-TV-2', 'SN-1100');
      const q3 = await equip('W008-TV-3', 'SN-1300');
      const q4 = await equip('W008-TV-4', null);
      const q5 = await equip('W008-TV-5', 'SN-1000', { modelo: 'BI-300' });
      const meus = new Set([q1.id, q2.id, q3.id, q4.id, q5.id]);

      const conferirFaixa = (x: CamposAlertaParaGravar) => () =>
        faixaInvertida(x.serieInicio, x.serieFim) ? ('faixa-invertida' as const) : null;
      const invertida = await codigoDe(
        incluirAlertaEquipamentoSgh(e, {
          ...alertaBase,
          serieInicio: 'SN-1200',
          serieFim: 'SN-900',
          usuario: USUARIO,
          conferir: conferirFaixa({ ...alertaBase, serieInicio: 'SN-1200', serieFim: 'SN-900' }),
        }),
      );
      const al = await incluirAlertaEquipamentoSgh(e, {
        ...alertaBase,
        usuario: USUARIO,
        conferir: conferirFaixa(alertaBase),
      });
      const repetido = await codigoDe(
        incluirAlertaEquipamentoSgh(e, {
          ...alertaBase,
          usuario: USUARIO,
          conferir: conferirFaixa(alertaBase),
        }),
      );
      // Alterar pela versão antes da OS: a faixa pode mudar.
      const alterar = (versaoVista: number, x: Partial<CamposAlertaParaGravar>) =>
        alterarAlertaEquipamentoSgh(e, {
          ...alertaBase,
          ...x,
          id: al.id,
          versaoVista,
          motivo: 'Faixa corrigida pelo boletim (teste)',
          usuario: USUARIO,
          conferir: (atual) => {
            const c = conferirAlteracaoAlerta(atual, versaoVista, { ...alertaBase, ...x });
            return c.ok ? null : c.motivo;
          },
        });
      const alterado = await alterar(1, { serieFim: 'SN-1250' });
      const velho = await codigoDe(alterar(1, { serieFim: 'SN-1250' }));

      const parque = await lerParqueDoAlerta(e, e.hospital, al.id);
      const lido = await lerAlertaEquipamento(e, e.hospital, al.id);
      const lista = afetadosDoAlerta(
        parque.filter((p) => meus.has(p.id)),
        lido!,
        [],
      ).map((x) => [x.equipamento, x.enquadramento]);

      // Uma OS por afetado (q1, q2); de novo: sem-afetados; o a conferir (q4) quando pedido.
      const geracao = await gerarAcaoDeCampoSgh(e, {
        id: al.id,
        versaoVista: 2,
        prioridade: 'alta',
        usuario: USUARIO,
        registro: agora,
        planejar: planejar(),
      });
      const deNovo = await codigoDe(
        gerarAcaoDeCampoSgh(e, {
          id: al.id,
          versaoVista: 3,
          prioridade: 'alta',
          usuario: USUARIO,
          registro: agora,
          planejar: planejar(),
        }),
      );
      const conferido = await gerarAcaoDeCampoSgh(e, {
        id: al.id,
        versaoVista: 3,
        prioridade: 'media',
        usuario: USUARIO,
        registro: agora,
        planejar: planejar([q4.id]),
      });
      const acoes = await lerAcoesDoAlerta(e, e.hospital, al.id);
      const osQ1 = await e.consultar(
        'SELECT NATUREZA, DESCRICAO, PRIORIDADE, SITUACAO FROM SGH_MAN_OS WHERE ID = ?',
        [geracao.geradas[0]?.os],
        { teto: 1 },
      );
      // O critério travado depois da OS (o texto ainda muda).
      const criterioTravado = await codigoDe(alterar(4, { serieFim: 'SN-1500', serieInicio: 'SN-900' }));
      const soTexto = await alterar(4, {
        serieFim: 'SN-1250',
        titulo: 'Falha no sensor de oclusão (revisado)',
      });

      // A queixa técnica da OS, na qualidade.
      const osAlvo = geracao.geradas[0]!.os;
      const queixa = await abrirQueixaDaOsSgh(e, {
        os: osAlvo,
        tipo: 'alertaSanitario',
        descricao: 'Sensor sem alarme confirmado na inspeção (teste).',
        conduta: 'suspensoUso',
        usuario: USUARIO,
        agora,
      });
      const [qq] = await e.consultar(
        `SELECT AREA, TIPO, SERIE, FABRICANTE, ALERTA, CONDUTA, SITUACAO, REGISTRO_ANVISA, DESCRICAO
           FROM SGH_QUA_TECNOVIG WHERE ID = ?`,
        [queixa.id],
        { teto: 1 },
      );
      const segunda = await codigoDe(
        abrirQueixaDaOsSgh(e, {
          os: osAlvo,
          tipo: 'queixaTecnica',
          descricao: 'Segunda tentativa (teste).',
          conduta: 'nenhuma',
          usuario: USUARIO,
          agora,
        }),
      );
      const vinculos = await lerVinculosTecnovigDaOs(e, e.hospital, osAlvo);
      // Revisão W0-08: com OS e queixa citando o número, trocar o número recusa (regra pura e, sozinha, a gravação).
      const numeroTravado = await codigoDe(
        alterar(5, { numero: `${alertaBase.numero}X`, serieFim: 'SN-1250' }),
      );
      const numeroTravadoNaGravacao = await codigoDe(
        alterarAlertaEquipamentoSgh(e, {
          ...alertaBase,
          numero: `${alertaBase.numero}X`,
          serieFim: 'SN-1250',
          id: al.id,
          versaoVista: 5,
          motivo: 'Número corrigido (teste)',
          usuario: USUARIO,
          conferir: () => null,
        }),
      );
      const numeroDepois = (await lerAlertaEquipamento(e, e.hospital, al.id))?.numero;

      // Exclusão com OS: recusa com a contagem e a oferta do encerramento.
      let recusaExclusao: unknown = null;
      try {
        await excluirAlertaEquipamentoSgh(e, {
          id: al.id,
          versaoVista: 5,
          motivo: 'Teste de recusa',
          usuario: USUARIO,
        });
      } catch (x) {
        recusaExclusao = x instanceof ErroOperacao ? x.problema : String(x);
      }
      // Alerta sem vínculo: excluído com o retrato.
      const solto = await incluirAlertaEquipamentoSgh(e, {
        ...alertaBase,
        numero: 'W008-ALERTA-2',
        usuario: USUARIO,
        conferir: conferirFaixa(alertaBase),
      });
      await excluirAlertaEquipamentoSgh(e, {
        id: solto.id,
        versaoVista: 1,
        motivo: 'Registrado por engano (teste)',
        usuario: USUARIO,
      });
      const soltoDepois = await lerAlertaEquipamento(e, e.hospital, solto.id);
      const retratos = await e.consultar(
        `SELECT TABELA FROM SGH_HIST_EXCLUSAO WHERE HOSPITAL = ? AND OPERACAO = 'manutencao.alerta.excluido'
          AND MOTIVO = ?`,
        [e.hospital, 'Registrado por engano (teste)'],
      );
      // Encerrar com motivo; depois não muda.
      const encerrado = await encerrarAlertaEquipamentoSgh(e, {
        id: al.id,
        versaoVista: 5,
        motivo: 'Ação de campo concluída em todos (teste)',
        usuario: USUARIO,
      });
      const fim = await lerAlertaEquipamento(e, e.hospital, al.id);
      const depoisDeEncerrado = await codigoDe(alterar(6, {}));
      const escritas = await escritasDaTransacao(e0);
      return {
        q: { q1, q2, q3, q4, q5 },
        invertida,
        repetido,
        alterado,
        velho,
        lista,
        geracao,
        deNovo,
        conferido,
        acoes,
        osQ1: osQ1[0],
        criterioTravado,
        soTexto,
        queixa,
        qq,
        segunda,
        vinculos,
        numeroTravado,
        numeroTravadoNaGravacao,
        numeroDepois,
        recusaExclusao,
        soltoDepois,
        retratos: retratos.map((x) => String(x['TABELA']).trim()),
        encerrado,
        fim,
        depoisDeEncerrado,
        escritas,
      };
    });
    const depois = await a.nucleo.lerSomente(ctx, retrato);
    const { q1, q2, q3, q4, q5 } = r.q;
    void q3;
    void q5;
    expect(r.invertida).toBe('faixa-invertida');
    expect(r.repetido).toBe('numero-repetido');
    expect(r.alterado.versao).toBe(2);
    expect(r.velho).toBe('desatualizado');
    // A faixa: q1 (SN-0950) e q2 (SN-1100) afetados; q3 fora da faixa e q5 de outro modelo ficam fora; q4 a conferir.
    expect(r.lista).toEqual([
      [q1.id, 'afetado'],
      [q2.id, 'afetado'],
      [q4.id, 'conferir'],
    ]);
    expect(r.geracao.geradas.map((g) => g.equipamento)).toEqual([q1.id, q2.id]);
    expect(r.geracao.versao).toBe(3);
    expect(r.deNovo).toBe('sem-afetados');
    expect(r.conferido.geradas.map((g) => g.equipamento)).toEqual([q4.id]);
    expect(r.acoes.map((x) => x.equipamento)).toEqual([q1.id, q2.id, q4.id]);
    expect(r.osQ1).toMatchObject({ NATUREZA: 'inspecao', PRIORIDADE: 'alta', SITUACAO: 'aberta' });
    expect(String(r.osQ1?.['DESCRICAO'])).toContain('Recall W008-ALERTA-1');
    expect(r.criterioTravado).toBe('alerta-com-acao');
    expect(r.numeroTravado).toBe('numero-com-vinculo');
    expect(r.numeroTravadoNaGravacao).toBe('numero-com-vinculo');
    expect(r.numeroDepois).toBe(alertaBase.numero);
    expect(r.soTexto.versao).toBe(5);
    expect(r.qq).toMatchObject({
      AREA: 'tecnovigilancia',
      TIPO: 'alertaSanitario',
      SERIE: 'SN-0950',
      FABRICANTE: FABRICANTE,
      ALERTA: 'W008-ALERTA-1',
      CONDUTA: 'suspensoUso',
      SITUACAO: 'aberta',
      REGISTRO_ANVISA: '80000000001',
    });
    expect(String(r.qq?.['DESCRICAO'])).toMatch(/^OS \d{4}-\d{6}: Sensor sem alarme/);
    expect(r.segunda).toBe('queixa-ja-aberta');
    expect(r.vinculos).toEqual({
      queixa: r.queixa.id,
      alerta: expect.objectContaining({ numero: 'W008-ALERTA-1' }),
    });
    expect(r.recusaExclusao).toMatchObject({
      codigo: 'com-dependentes',
      podeInativar: true,
      dependentes: expect.arrayContaining([
        expect.objectContaining({
          rotulo: 'Ordens de serviço de ação de campo',
          quantidade: 3,
          origem: 'fk',
        }),
        expect.objectContaining({
          rotulo: 'Queixas técnicas da vigilância de produto',
          quantidade: 1,
          origem: 'logica',
        }),
      ]),
    });
    expect(r.soltoDepois).toBeNull();
    expect(r.retratos).toEqual(['SGH_MAN_ALERTA']);
    expect(r.encerrado.versao).toBe(6);
    expect(r.fim).toMatchObject({
      situacao: 'encerrado',
      motivo: 'Ação de campo concluída em todos (teste)',
      acoes: 3,
    });
    expect(r.depoisDeEncerrado).toBe('alerta-encerrado');
    for (const x of r.escritas) expect(x.tabela).toMatch(/^SGH_/);
    expect(depois).toBe(antes);
  }, 300_000);
});
