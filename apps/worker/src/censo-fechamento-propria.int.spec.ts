// Integração da porta própria do fechamento do censo sobre o MariaDB real (cliente f22_o5; lote F2.2 05-15): a chave
// ligada com os pré-requisitos cumpridos; só o estabelecimento em atividade entra na volta (o desativado e o de fim de
// atividade vencido ficam de fora); o ciclo inteiro (movimento lido do banco, motor do domínio, gravarDia) com duas
// unidades de internação no mesmo bloco e o mesmo código de quarto, uma acomodação sem bloco, uma transferência entre
// as unidades e um óbito: os totais por unidade em fechamento_censo e fechamento_censo_unidade, a terapia intensiva pela
// categoria da acomodação, a trilha; o segundo fechamento do mesmo dia desiste (null); o dia fechado aparece nos dias
// fechados; a linha sem unidade no cadastro é erro (nunca descartada). Massa sintética com as chaves estrangeiras
// desligadas só na montagem; apagada no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { GRUPOS_MOTIVO_ALTA, recursoDesligado } from '@sgh/contratos';
import { MotorInternacao, relogioDeParede } from '@sgh/dominio-internacao';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHAVE_FECHAMENTO, ErroCensoSemUnidade, PortaCensoPropria } from './censo-fechamento-propria.js';
import { CLIENTE, escrever, garantirCliente, garantirEstabelecimento, inserirSintetico, SEM_BANCO } from './importadores/integracao.spec-util.js';
import type { AlvoEstabelecimento } from './servico-worker.js';

const DIA = '2026-10-10';
const CODIGOS_GLOBAIS = { categoria: ['F515ENF', 'F515UTI'], carater: 'F515CA', especialidade: 'F515ESP', motivo: 'F515OB' };

const LINHA = {
  acomodacao: 'ENF',
  nome: 'Enfermaria sintética',
  tipo: { id: 1, nome: 'Enfermaria' },
  intensiva: false,
  internados: 3,
  admissoes: 1,
  altas: Object.fromEntries(GRUPOS_MOTIVO_ALTA.map((g) => [g, 0])) as never,
  saidas: 1,
  obitos: 0,
  transferenciasEntrada: 0,
  transferenciasSaida: 0,
  leitosOperacionais: 4,
};

describe.skipIf(SEM_BANCO)('fechamento do censo sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est: AlvoEstabelecimento;
  let inativos: number[] = [];
  const u = { enf: 0, uti: 0 };
  let catUti = 0;

  async function limpar(id: number): Promise<void> {
    await escrever(nucleo, async (e) => {
      // Bloco e unidade se apontam (e a ocupação aponta a anterior): a limpeza da massa desliga as chaves.
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      await e.executar(
        'DELETE u FROM fechamento_censo_unidade u JOIN fechamento_censo f ON f.id = u.fechamento_censo_id WHERE f.estabelecimento_id = ?',
        [id],
      );
      for (const t of ['fechamento_censo', 'ocupacao_leito', 'internacao', 'leito_hospitalar', 'acomodacao', 'bloco_internacao'])
        await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id = ?`, [id]);
      await e.executar('DELETE FROM unidade_internacao WHERE estabelecimento_id = ?', [id]);
      await e.executar('DELETE FROM liberacao_chave WHERE estabelecimento_id = ? AND chave = ?', [id, CHAVE_FECHAMENTO]);
      await e.executar('DELETE FROM recurso_prerequisito WHERE estabelecimento_id = ? AND recurso = ?', [id, CHAVE_FECHAMENTO]);
      await e.executar('DELETE FROM categoria_acomodacao WHERE codigo IN (?, ?)', CODIGOS_GLOBAIS.categoria);
      await e.executar('DELETE FROM carater_admissao WHERE codigo = ?', [CODIGOS_GLOBAIS.carater]);
      await e.executar('DELETE FROM especialidade_medica WHERE codigo = ?', [CODIGOS_GLOBAIS.especialidade]);
      await e.executar('DELETE FROM motivo_saida_hospitalar WHERE codigo = ?', [CODIGOS_GLOBAIS.motivo]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    const id = await escrever(nucleo, (e) => garantirEstabelecimento(e, 'f515c'));
    est = { cliente: CLIENTE, id, codigo: 'f515c', fuso: 'America/Sao_Paulo' };
    await limpar(id);
    inativos = await escrever(nucleo, async (e) => {
      const desativado = await garantirEstabelecimento(e, 'f515d');
      const encerrado = await garantirEstabelecimento(e, 'f515e');
      await e.executar('UPDATE estabelecimento SET ativo = FALSE, fim_atividade = NULL WHERE id = ?', [desativado]);
      await e.executar("UPDATE estabelecimento SET ativo = TRUE, inicio_atividade = NULL, fim_atividade = '2020-01-01' WHERE id = ?", [
        encerrado,
      ]);
      return [desativado, encerrado];
    });
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      const bloco = await inserirSintetico(e, 'bloco_internacao', { estabelecimento_id: id, codigo: 'B515', nome: 'Bloco sintético', criado_em: agora });
      u.enf = await inserirSintetico(e, 'unidade_internacao', {
        estabelecimento_id: id,
        unidade_assistencial_id: 9_905_151,
        codigo: 'F515UI',
        descricao: 'Enfermaria sintética 05-15',
        tipo: 'enfermaria',
        bloco_internacao_id: bloco,
        criado_em: agora,
      });
      u.uti = await inserirSintetico(e, 'unidade_internacao', {
        estabelecimento_id: id,
        unidade_assistencial_id: 9_905_152,
        codigo: 'F515UTI',
        descricao: 'Terapia intensiva sintética 05-15',
        tipo: 'uti_adulto',
        intensiva: true,
        bloco_internacao_id: bloco,
        criado_em: agora,
      });
      // O bloco aponta a enfermaria (a de menor id): o retrato da terapia intensiva não pode cair nela.
      await e.executar('UPDATE bloco_internacao SET unidade_internacao_id = ? WHERE id = ?', [u.enf, bloco]);
      const catEnf = await inserirSintetico(e, 'categoria_acomodacao', { codigo: 'F515ENF', descricao: 'Enfermaria sintética', tipo: 'enfermaria', criado_em: agora });
      catUti = await inserirSintetico(e, 'categoria_acomodacao', {
        codigo: 'F515UTI',
        descricao: 'Terapia intensiva sintética',
        tipo: 'terapia_intensiva',
        criado_em: agora,
      });
      const acom = (unidade: number, codigo: string, categoria: number, blocoId: number | null) =>
        inserirSintetico(e, 'acomodacao', {
          estabelecimento_id: id,
          unidade_internacao_id: unidade,
          bloco_internacao_id: blocoId,
          categoria_acomodacao_id: categoria,
          codigo,
          nome: `Quarto ${codigo}`,
          sexo_permitido: 'indiferente',
          tipo_atendimento: 'internacao',
          abrangencia_cobertura: 'todas',
          criado_em: agora,
        });
      // Mesmo código de quarto (101) nas duas unidades do mesmo bloco; o 201 da terapia intensiva sem bloco.
      const a1 = await acom(u.enf, '101', catEnf, bloco);
      const a2 = await acom(u.uti, '101', catUti, bloco);
      const a3 = await acom(u.uti, '201', catUti, null);
      const leito = (unidade: number, acomodacao: number, codigo: string) =>
        inserirSintetico(e, 'leito_hospitalar', {
          estabelecimento_id: id,
          unidade_internacao_id: unidade,
          acomodacao_id: acomodacao,
          codigo,
          sexo_permitido: 'qualquer',
          criticidade: 'baixa',
          criado_em: agora,
        });
      const l1 = await leito(u.enf, a1, '101A');
      await leito(u.enf, a1, '101B');
      const l2 = await leito(u.uti, a2, '101A');
      const l3 = await leito(u.uti, a3, '201A');
      const carater = await inserirSintetico(e, 'carater_admissao', { codigo: 'F515CA', descricao: 'Eletiva sintética', criado_em: agora });
      const esp = await inserirSintetico(e, 'especialidade_medica', {
        codigo: 'F515ESP',
        descricao: 'Clínica sintética',
        tipo: 'medica',
        sexo_atendido: 'ambos',
        criado_em: agora,
      });
      const obito = await inserirSintetico(e, 'motivo_saida_hospitalar', {
        codigo: 'F515OB',
        descricao: 'Óbito sintético',
        tipo_saida: 'obito',
        exige_declaracao_obito: true,
        criado_em: agora,
      });
      const internacao = (k: number, v: Record<string, unknown>) =>
        inserirSintetico(e, 'internacao', {
          estabelecimento_id: id,
          numero: `F515-${k}`,
          atendimento_id: 9_905_151_000 + k,
          paciente_id: 9_905_151_000 + k,
          carater_admissao_id: carater,
          especialidade_medica_id: esp,
          origem: 'sistema',
          criado_em: agora,
          ...v,
        });
      // 1: entra na enfermaria em 08/10 e passa à terapia intensiva no dia 10 às 08:00 (São Paulo).
      const i1 = await internacao(1, {
        data_hora_entrada: new Date('2026-10-08T13:00:00Z'),
        unidade_internacao_id: u.uti,
        acomodacao_id: a2,
        leito_hospitalar_id: l2,
        situacao: 'ativa',
      });
      // 2: entra na terapia intensiva sem bloco em 09/10 e morre no dia 10 às 15:00.
      const i2 = await internacao(2, {
        data_hora_entrada: new Date('2026-10-09T13:00:00Z'),
        data_hora_alta: new Date('2026-10-10T18:00:00Z'),
        motivo_saida_hospitalar_id: obito,
        unidade_internacao_id: u.uti,
        acomodacao_id: a3,
        leito_hospitalar_id: null,
        situacao: 'alta',
      });
      const ocupacao = (v: Record<string, unknown>) =>
        inserirSintetico(e, 'ocupacao_leito', { estabelecimento_id: id, origem: 'sistema', criado_em: agora, ...v });
      const o1 = await ocupacao({
        internacao_id: i1,
        leito_hospitalar_id: l1,
        unidade_internacao_id: u.enf,
        acomodacao_id: a1,
        data_hora_inicio: new Date('2026-10-08T13:00:00Z'),
        data_hora_fim: new Date('2026-10-10T11:00:00Z'),
        tipo_movimento: 'admissao',
        situacao: 'encerrada',
      });
      await ocupacao({
        internacao_id: i1,
        leito_hospitalar_id: l2,
        unidade_internacao_id: u.uti,
        acomodacao_id: a2,
        data_hora_inicio: new Date('2026-10-10T11:00:00Z'),
        tipo_movimento: 'transferencia',
        anterior_ocupacao_leito_id: o1,
        situacao: 'ativa',
      });
      await ocupacao({
        internacao_id: i2,
        leito_hospitalar_id: l3,
        unidade_internacao_id: u.uti,
        acomodacao_id: a3,
        data_hora_inicio: new Date('2026-10-09T13:00:00Z'),
        data_hora_fim: new Date('2026-10-10T18:00:00Z'),
        tipo_movimento: 'admissao',
        situacao: 'encerrada',
      });
      await inserirSintetico(e, 'liberacao_chave', {
        estabelecimento_id: id,
        tipo: 'recurso',
        chave: CHAVE_FECHAMENTO,
        escopo: 'hospital',
        valor: '*',
        ligada: 1,
        criado_em: agora,
      });
      for (const tipo of new Set((recursoDesligado(CHAVE_FECHAMENTO)?.prerequisitos ?? []).map((p) => p.tipo)))
        await inserirSintetico(e, 'recurso_prerequisito', {
          estabelecimento_id: id,
          recurso: CHAVE_FECHAMENTO,
          tipo,
          situacao: 'cumprido',
          criado_em: agora,
        });
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar(est.id);
    // Os estabelecimentos f515d e f515e (fora de atividade) ficam: outros registros do cliente de teste os apontam.
    await nucleo.encerrar();
  });

  it('a chave ligada com os pré-requisitos; só o estabelecimento em atividade entra; intensiva pela categoria', async () => {
    const porta = new PortaCensoPropria(nucleo, CLIENTE);
    const cfg = await porta.configuracao(est, new Date());
    expect(cfg.ligada).toBe(true);
    expect(cfg.categoriasIntensivas).toContain(catUti);
    const ests = (await porta.estabelecimentos()).map((x) => x.id);
    expect(ests).toContain(est.id);
    for (const id of inativos) expect(ests).not.toContain(id);
  });

  it('ciclo inteiro: movimento do banco, motor e retrato por unidade (mesmo bloco, quarto repetido, sem bloco)', async () => {
    const porta = new PortaCensoPropria(nucleo, CLIENTE);
    const cfg = await porta.configuracao(est, new Date());
    const mov = await porta.movimento(est);
    expect(mov.internacoes.map((i) => i.bloco).sort()).toEqual(['F515UI', 'F515UTI']);
    expect(mov.transferencias).toHaveLength(1);
    expect(mov.transferencias[0]).toMatchObject({ origem: { bloco: 'F515UI', acomodacao: '101' }, destino: { bloco: 'F515UTI', acomodacao: '101' } });
    expect(mov.trechos.find((t) => t.horaEntrada === '0800')).toMatchObject({ bloco: 'F515UTI', tipo: catUti });
    expect(mov.unidades.map((x) => [x.bloco, x.acomodacao, x.leitos]).sort()).toEqual([
      ['F515UI', '101', 2],
      ['F515UTI', '101', 1],
      ['F515UTI', '201', 1],
    ]);
    const motor = new MotorInternacao(mov, {
      horaFechamento: 24,
      intensivas: cfg.categoriasIntensivas,
      agora: relogioDeParede(Date.now(), est.fuso),
    });
    const linhas = motor.censoDoDia(DIA);
    expect(linhas.filter((l) => l.bloco === 'F515UTI').every((l) => l.intensiva)).toBe(true);
    expect(linhas.filter((l) => l.bloco === 'F515UI').some((l) => l.intensiva)).toBe(false);
    const g = await porta.gravarDia(est, { data: DIA, horaFechamento: 24, versaoCalculo: 1, linhas });
    expect(g).toMatchObject({ unidades: 2, linhas: 3 });
    const retrato = await escrever(nucleo, (e) =>
      e.consultar(
        `SELECT f.unidade_internacao_id AS u, f.situacao, f.versao, f.pacientes_dia, f.obitos, f.transferencias_entrada,
                f.transferencias_saida, f.leitos_operacionais, x.obitos AS obitos_unidade, x.transferencias_entrada AS te_unidade,
                x.transferencias_saida AS ts_unidade, x.pacientes_fim_dia, x.leitos_operacionais AS leitos_unidade
           FROM fechamento_censo f JOIN fechamento_censo_unidade x ON x.fechamento_censo_id = f.id
          WHERE f.estabelecimento_id = ? AND f.data_referencia = ? ORDER BY f.unidade_internacao_id`,
        [est.id, DIA],
      ),
    );
    const por = new Map(retrato.map((r) => [Number(r['u']), r]));
    expect(por.size).toBe(2);
    expect(por.get(u.enf)).toMatchObject({ situacao: 'fechado', versao: 1, transferencias_entrada: 0, transferencias_saida: 1, obitos: 0, pacientes_dia: 0 });
    expect(por.get(u.enf)).toMatchObject({ ts_unidade: 1, pacientes_fim_dia: 0, leitos_unidade: 2 });
    expect(por.get(u.uti)).toMatchObject({ situacao: 'fechado', transferencias_entrada: 1, transferencias_saida: 0, obitos: 1, pacientes_dia: 1 });
    expect(por.get(u.uti)).toMatchObject({ te_unidade: 1, obitos_unidade: 1, pacientes_fim_dia: 1, leitos_unidade: 2 });
    const trilha = await escrever(nucleo, (e) =>
      e.uma("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'fechamento_censo'", [est.id]),
    );
    expect(Number(trilha!['n'])).toBeGreaterThanOrEqual(1);
    expect(await porta.gravarDia(est, { data: DIA, horaFechamento: 24, versaoCalculo: 1, linhas })).toBeNull();
    expect(await porta.diasFechados(est, '2026-10-04', DIA)).toEqual([DIA]);
  });

  it('linha sem unidade de internação no cadastro: erro de integridade, nada gravado', async () => {
    const porta = new PortaCensoPropria(nucleo, CLIENTE);
    await expect(
      porta.gravarDia(est, { data: '2026-10-09', horaFechamento: 24, versaoCalculo: 1, linhas: [{ ...LINHA, bloco: 'NAO-EXISTE' }] }),
    ).rejects.toBeInstanceOf(ErroCensoSemUnidade);
    expect(await porta.diasFechados(est, '2026-10-09', '2026-10-09')).toEqual([]);
    expect(await porta.gravarDia(est, { data: '2026-10-08', horaFechamento: 24, versaoCalculo: 1, linhas: [] })).toEqual({
      unidades: 0,
      linhas: 0,
      internados: 0,
    });
  });
});
