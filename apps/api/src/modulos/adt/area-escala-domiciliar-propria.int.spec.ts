// Contrato de efeito das áreas e da escala da atenção domiciliar (C2-105, 03-PEP linha 143) contra o MariaDB real
// (cliente de teste). Massa SINTÉTICA: estabelecimento com o código do teste, uma pessoa e paciente sintéticos com
// endereço, tipo de chamado e uma internação domiciliar ativa; usuário e profissionais são ids já existentes do
// cliente (só lidos). Prova o que fica em `area_atendimento_domiciliar`, `area_atendimento_domiciliar_cep`,
// `area_atendimento_domiciliar_profissional`, `escala_atendimento_domiciliar` e `visita_domiciliar`: a área com as
// faixas numeradas, a troca das faixas que marca as antigas como excluídas, a área do CEP, o vínculo do profissional,
// o turno da escala, a visita agendada ligada ao turno, o turno lotado que recusa, a grade com as vagas, o
// encerramento do turno e do vínculo, a inativação da área e as recusas sem gravar nada.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { diaSemanaEscala } from '@sgh/dominio-internacao';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaAreaEscalaDomiciliarPropria } from './area-escala-domiciliar-propria.js';
import { PortaInternacaoDomiciliarPropria } from './internacao-domiciliar-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2105dom';
const NOME = `PESSOA SINTETICA ${P} UM`;
// Data futura fixa (vigência própria do teste: não cruza a escala de outra massa).
const DIA = '2031-03-04';

type Massa = Record<string, number>;

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM visita_domiciliar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM internacao_domiciliar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM escala_atendimento_domiciliar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE f FROM area_atendimento_domiciliar_cep f JOIN area_atendimento_domiciliar a
          ON a.id = f.area_atendimento_domiciliar_id WHERE a.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(
      `DELETE v FROM area_atendimento_domiciliar_profissional v JOIN area_atendimento_domiciliar a
          ON a.id = v.area_atendimento_domiciliar_id WHERE a.estabelecimento_id IN ${est}`,
      [P],
    );
    await e.executar(`DELETE FROM area_atendimento_domiciliar WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(
      `DELETE en FROM endereco_pessoa en JOIN pessoa_fisica pf ON pf.id = en.pessoa_fisica_id WHERE pf.nome = ?`,
      [NOME],
    );
    await e.executar(
      'DELETE p FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE pf.nome = ?',
      [NOME],
    );
    await e.executar('DELETE FROM pessoa_fisica WHERE nome = ?', [NOME]);
    await e.executar('DELETE FROM tipo_chamado_domiciliar WHERE codigo LIKE ?', [`${P}-%`]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

const recusa = { problema: { codigo: 'regra-violada' } };

describe.skipIf(SEM_BANCO)('PortaAreaEscalaDomiciliarPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAreaEscalaDomiciliarPropria;
  let internacao: PortaInternacaoDomiciliarPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m['usuario']!, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const contar = async () =>
    Number(
      (
        await ler(
          `SELECT (SELECT COUNT(*) FROM area_atendimento_domiciliar WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM area_atendimento_domiciliar_cep f JOIN area_atendimento_domiciliar a
                     ON a.id = f.area_atendimento_domiciliar_id WHERE a.estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM area_atendimento_domiciliar_profissional v JOIN area_atendimento_domiciliar a
                     ON a.id = v.area_atendimento_domiciliar_id WHERE a.estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM escala_atendimento_domiciliar WHERE estabelecimento_id = ?)
                + (SELECT COUNT(*) FROM visita_domiciliar WHERE estabelecimento_id = ?) AS n`,
          [m['est'], m['est'], m['est'], m['est'], m['est']],
        )
      )[0]!['n'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const tipoEnd = await um('SELECT MIN(id) AS id FROM tipo_endereco');
      const municipio = await um('SELECT MIN(id) AS id FROM municipio_ibge');
      const profs = (
        await e.consultar('SELECT id FROM profissional WHERE excluido_em IS NULL ORDER BY id LIMIT 2')
      ).map((x) => Number(x['id']));
      if (!usuario || !tipoEnd || !municipio || profs.length < 2)
        throw new Error(
          'O cliente de teste precisa de usuário, tipo de endereço, município e 2 profissionais.',
        );
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [NOME, agora]);
      const pac = await e.inserir(
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pf, 902_105_001, agora],
      );
      const end = await e.inserir(
        `INSERT INTO endereco_pessoa (pessoa_fisica_id, sequencia, tipo_endereco_id, cep, logradouro, numero,
           bairro_nome, municipio_ibge_id, principal, criado_em)
         VALUES (?, 1, ?, '02100500', 'Rua Sintética', '10', 'Bairro Fictício', ?, TRUE, ?)`,
        [pf, tipoEnd, municipio, agora],
      );
      const tipo = await e.inserir(
        'INSERT INTO tipo_chamado_domiciliar (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-ROT`, 'Visita de rotina sintética', agora],
      );
      const dom = await e.inserir(
        `INSERT INTO internacao_domiciliar (estabelecimento_id, numero, paciente_id, endereco_pessoa_id,
           data_solicitacao, situacao, data_hora_inicio, medico_responsavel_profissional_id, criado_em)
         VALUES (?, ?, ?, ?, ?, 'ativa', ?, ?, ?)`,
        [est, `${P}-1`, pac, end, '2026-11-01', new Date('2026-11-02T12:00:00Z'), profs[0], agora],
      );
      return { usuario, est, pac, tipo, dom, prof1: profs[0]!, prof2: profs[1]! };
    });
    porta = new PortaAreaEscalaDomiciliarPropria(nucleo, CLIENTE);
    internacao = new PortaInternacaoDomiciliarPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar();
  }, 60_000);

  it('área com faixas, troca das faixas sem apagar, CEP e sobreposição recusada', async () => {
    const a = await porta.salvarArea(ctx(), null, {
      codigo: 'norte',
      descricao: 'Zona norte sintética',
      faixas: [
        { cepInicial: '02000-000', cepFinal: '02999-999' },
        { cepInicial: '07000000', cepFinal: '07099999' },
      ],
    });
    m['areaA'] = a.id!;
    const [area] = await ler('SELECT * FROM area_atendimento_domiciliar WHERE id = ?', [a.id]);
    expect(area).toMatchObject({ codigo: 'NORTE', estabelecimento_id: m['est'] });
    expect(Boolean(area!['ativo'])).toBe(true);
    const faixas = await ler(
      'SELECT sequencia, cep_inicial, cep_final, excluido_em FROM area_atendimento_domiciliar_cep WHERE area_atendimento_domiciliar_id = ? ORDER BY sequencia',
      [a.id],
    );
    expect(faixas.map((f) => [Number(f['sequencia']), f['cep_inicial'], f['cep_final']])).toEqual([
      [1, '02000000', '02999999'],
      [2, '07000000', '07099999'],
    ]);

    const antes = await contar();
    await expect(
      porta.salvarArea(ctx(), null, {
        codigo: 'sul',
        descricao: 'Zona sul sintética',
        faixas: [{ cepInicial: '02500000', cepFinal: '04999999' }],
      }),
    ).rejects.toMatchObject(recusa);
    await expect(
      porta.salvarArea(ctx(), null, { codigo: 'NORTE', descricao: 'Repetida', faixas: [] }),
    ).rejects.toMatchObject(recusa);
    expect(await contar()).toBe(antes);

    await porta.salvarArea(ctx(), a.id!, {
      codigo: 'NORTE',
      descricao: 'Zona norte sintética (revista)',
      faixas: [{ cepInicial: '02100000', cepFinal: '02199999' }],
      versao: Number(area!['versao']),
    });
    const depois = await ler(
      'SELECT sequencia, excluido_em, excluido_por FROM area_atendimento_domiciliar_cep WHERE area_atendimento_domiciliar_id = ? ORDER BY sequencia',
      [a.id],
    );
    expect(depois.map((f) => [Number(f['sequencia']), f['excluido_em'] !== null])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
    expect(Number(depois[0]!['excluido_por'])).toBe(m['usuario']);
    expect(await porta.areaPorCep(ctx(), '02100-500')).toEqual({ cep: '02100500', area: a.id });
    expect((await porta.areaPorCep(ctx(), '07000001')).area).toBeNull();
    const lista = await porta.areas(ctx());
    expect(lista.areas.find((x) => x.id === a.id)?.faixas).toHaveLength(1);
  });

  it('vínculo do profissional, turno da escala e visita ligada ao turno; lotado recusa', async () => {
    const v = await porta.vincularProfissional(ctx(), m['areaA']!, {
      profissional: m['prof1'],
      prioridade: 1,
      vigenciaInicio: '2031-01-01',
    });
    m['vinculo'] = v.id!;
    const antes = await contar();
    await expect(
      porta.vincularProfissional(ctx(), m['areaA']!, {
        profissional: m['prof1'],
        prioridade: 2,
        vigenciaInicio: '2031-02-01',
      }),
    ).rejects.toMatchObject(recusa);
    // prof2 não está na área: a escala da área é recusada.
    const dia = diaSemanaEscala(DIA);
    const turno = {
      area: m['areaA'],
      profissional: m['prof2'],
      tipoChamado: null,
      diaSemana: dia,
      horaInicio: '08:00',
      horaFim: '12:00',
      quantidade: 1,
      vigenciaInicio: '2031-03-01',
    };
    await expect(porta.criarEscala(ctx(), turno)).rejects.toMatchObject(recusa);
    expect(await contar()).toBe(antes);

    const s = await porta.criarEscala(ctx(), { ...turno, profissional: m['prof1'] });
    m['escala'] = s.id!;
    const [linha] = await ler('SELECT * FROM escala_atendimento_domiciliar WHERE id = ?', [s.id]);
    expect(linha).toMatchObject({
      estabelecimento_id: m['est'],
      area_atendimento_domiciliar_id: m['areaA'],
      profissional_id: m['prof1'],
      dia_semana: dia,
      quantidade_atendimentos: 1,
      origem: 'sistema',
    });
    expect(String(linha!['hora_inicio']).slice(0, 5)).toBe('08:00');
    // Turno sobreposto do mesmo profissional no mesmo dia: recusa.
    await expect(
      porta.criarEscala(ctx(), { ...turno, profissional: m['prof1'], horaInicio: '11:00', horaFim: '14:00' }),
    ).rejects.toMatchObject(recusa);

    // A visita das 09:00 (hora local) cai no turno; a das 10:00 encontra o turno lotado (sem extra).
    const vis = await internacao.agendarVisita(ctx(), {
      internacao: m['dom'],
      profissional: m['prof1'],
      tipo: m['tipo'],
      quando: `${DIA}T09:00:00-03:00`,
      duracao: 30,
    });
    const [visita] = await ler('SELECT * FROM visita_domiciliar WHERE id = ?', [vis.id]);
    expect(Number(visita!['escala_atendimento_domiciliar_id'])).toBe(s.id);
    expect(Boolean(visita!['extra'])).toBe(false);
    const n = await contar();
    await expect(
      internacao.agendarVisita(ctx(), {
        internacao: m['dom'],
        profissional: m['prof1'],
        tipo: m['tipo'],
        quando: `${DIA}T10:00:00-03:00`,
        duracao: 30,
      }),
    ).rejects.toMatchObject(recusa);
    expect(await contar()).toBe(n);
    // Fora do turno (14:00) a visita entra sem escala.
    const fora = await internacao.agendarVisita(ctx(), {
      internacao: m['dom'],
      profissional: m['prof1'],
      tipo: m['tipo'],
      quando: `${DIA}T14:00:00-03:00`,
      duracao: 30,
    });
    const [semEscala] = await ler(
      'SELECT escala_atendimento_domiciliar_id AS e FROM visita_domiciliar WHERE id = ?',
      [fora.id],
    );
    expect(semEscala!['e']).toBeNull();

    const grade = await porta.grade(ctx(), DIA, 1);
    expect(grade.dias[0]!.turnos.map((t) => [t.id, t.ocupadas, t.livres])).toEqual([[s.id, 1, 0]]);
  });

  it('encerra o turno e o vínculo, inativa a área; nada se apaga', async () => {
    const [s] = await ler('SELECT versao FROM escala_atendimento_domiciliar WHERE id = ?', [m['escala']]);
    await expect(
      porta.acaoEscala(ctx(), m['escala']!, 'encerrar', {
        versao: Number(s!['versao']),
        vigenciaFim: '2031-02-01',
      }),
    ).rejects.toMatchObject(recusa);
    await porta.acaoEscala(ctx(), m['escala']!, 'encerrar', {
      versao: Number(s!['versao']),
      vigenciaFim: '2031-06-30',
    });
    const [v] = await ler('SELECT versao FROM area_atendimento_domiciliar_profissional WHERE id = ?', [
      m['vinculo'],
    ]);
    await porta.encerrarVinculo(ctx(), m['vinculo']!, {
      versao: Number(v!['versao']),
      vigenciaFim: '2031-06-30',
    });
    const [a] = await ler('SELECT versao FROM area_atendimento_domiciliar WHERE id = ?', [m['areaA']]);
    await porta.acaoArea(ctx(), m['areaA']!, 'inativar', { versao: Number(a!['versao']) });

    const [escala] = await ler('SELECT vigencia_fim, ativo FROM escala_atendimento_domiciliar WHERE id = ?', [
      m['escala'],
    ]);
    expect(
      String(
        escala!['vigencia_fim'] instanceof Date
          ? (escala!['vigencia_fim'] as Date).toISOString()
          : escala!['vigencia_fim'],
      ).slice(0, 10),
    ).toBe('2031-06-30');
    const [vinc] = await ler(
      'SELECT vigencia_fim, excluido_em FROM area_atendimento_domiciliar_profissional WHERE id = ?',
      [m['vinculo']],
    );
    expect(vinc!['vigencia_fim']).not.toBeNull();
    expect(vinc!['excluido_em']).toBeNull();
    const [area] = await ler('SELECT ativo FROM area_atendimento_domiciliar WHERE id = ?', [m['areaA']]);
    expect(Boolean(area!['ativo'])).toBe(false);
    expect((await porta.areaPorCep(ctx(), '02100500')).area).toBeNull();
  });
});
