// Contrato de efeito da auditoria da profilaxia antimicrobiana cirúrgica (F8, 04-CC linha 106) contra o MariaDB real
// (cliente de teste). Massa SINTÉTICA com o código "c2012pf": dois estabelecimentos fictícios, um paciente, um
// profissional, dois atendimentos, um procedimento num grupo, dois antimicrobianos fictícios (cefazolina e
// vancomicina, pelo princípio ativo do item prescrito), a prescrição com o horário checado no prontuário e três atos
// cirúrgicos em 2030 (nenhuma pessoa real); usuário, caráter, categoria e tipo de item são ids já existentes do
// cliente de teste (só os ids são lidos).
// Prova o que fica no banco: o protocolo incluído com a janela e o repique, a janela de 90 minutos recusada para a
// cefazolina sem escrita e a de 120 aceita para a vancomicina; desativar e reativar pela versão (nada apagado); a
// auditoria conforme (dose 30 minutos antes da incisão, item encerrado em 24 horas) com o avaliador e o instante; a
// nova auditoria do mesmo ato deixa a anterior no histórico com a marca de exclusão; a dose 90 minutos antes é não
// conforme; o ato sem incisão não é avaliável; o painel do período conta as cirurgias e a conformidade; a sessão de
// outro estabelecimento recebe 404 sem escrita.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { inserirMinimo } from '../suprimentos/massa-propria.spec-util.js';
import { PortaProfilaxiaCirurgicaPropria } from './profilaxia-cirurgica-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const P = 'c2012pf';
const P2 = `${P}b`;
const COD = (s: string) => `${P}${s}`.toUpperCase();

async function limpar(e: Escritor): Promise<void> {
  const ests = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
  const atos = `SELECT id FROM ato_cirurgico WHERE estabelecimento_id IN (${ests})`;
  const presc = `SELECT id FROM prescricao WHERE estabelecimento_id IN (${ests})`;
  await e.executar(`DELETE FROM auditoria_profilaxia_cirurgica WHERE ato_cirurgico_id IN (${atos})`, [P, P2]);
  await e.executar(`DELETE FROM ato_cirurgico_procedimento WHERE ato_cirurgico_id IN (${atos})`, [P, P2]);
  await e.executar(`DELETE FROM ato_cirurgico WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM protocolo_profilaxia_cirurgica WHERE estabelecimento_id IN (${ests})`, [
    P,
    P2,
  ]);
  await e.executar(`DELETE FROM horario_administracao WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM prescricao_item WHERE prescricao_id IN (${presc})`, [P, P2]);
  await e.executar(`DELETE FROM prescricao WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar('DELETE FROM item_prescritivel WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar('DELETE FROM unidade_prescricao WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar('DELETE FROM procedimento_cirurgico WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar('DELETE FROM grupo_procedimento_cirurgico WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar('DELETE FROM antimicrobiano WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar('DELETE FROM principio_ativo WHERE codigo_dcb LIKE ?', ['PF2012%']);
  await e.executar('DELETE FROM unidade_medida WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar('DELETE FROM via_de_uso WHERE codigo LIKE ?', [`${COD('')}%`]);
  await e.executar(`DELETE FROM atendimento WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM sala_cirurgica WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM unidade_cirurgica WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM unidade_assistencial WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  const pf = 'SELECT id FROM pessoa_fisica WHERE nome LIKE ?';
  await e.executar(`DELETE FROM profissional WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar(`DELETE FROM paciente WHERE pessoa_fisica_id IN (${pf})`, [`% ${COD('')}`]);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`% ${COD('')}`]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

const H = (h: number, m = 0, dia = 10) => new Date(2030, 2, dia, h, m);

describe.skipIf(SEM_BANCO)('PortaProfilaxiaCirurgicaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaProfilaxiaCirurgicaPropria;
  let m: {
    usuario: number;
    procedimento: number;
    grupo: number;
    cefazolina: number;
    vancomicina: number;
    unidade: number;
    via: number;
    atoA: number;
    atoB: number;
    atoC: number;
  };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<
      Record<string, unknown>[]
    >;
  const auditorias = (ato: number) =>
    ler(
      `SELECT id, situacao, avaliavel, droga_adequada, dose_adequada, momento_adequado, via_adequada,
              repique_adequado, duracao_adequada, protocolo_profilaxia_cirurgica_id AS protocolo,
              avaliador_usuario_id AS avaliador, avaliado_em IS NOT NULL AS avaliado, justificativa,
              excluido_em IS NOT NULL AS excluida, excluido_por, versao
         FROM auditoria_profilaxia_cirurgica WHERE ato_cirurgico_id = ? ORDER BY id`,
      [ato],
    );
  const protocoloBase = () => ({
    procedimento: m.procedimento,
    antimicrobiano: m.cefazolina,
    dose: 2000,
    unidade: m.unidade,
    via: m.via,
    antesMaximo: 60,
    intervaloRepiqueHoras: 4,
    duracaoMaximaHoras: 24,
    vigenciaInicio: '2030-01-01',
  });
  const recusa422 = { problema: { status: 422 } };
  let protocoloCefazolina = 0;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => Number((await e.uma(sql))?.['id'] ?? 0);
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const categoria = await um('SELECT MIN(id) AS id FROM categoria_atendimento');
      const caraterTiss = await um('SELECT MIN(id) AS id FROM carater_atendimento_tiss');
      const carater = await um('SELECT MIN(id) AS id FROM carater_cirurgia');
      const tipoItem = await um('SELECT MIN(id) AS id FROM tipo_item_prescricao');
      const checagem = await um('SELECT MIN(id) AS id FROM situacao_checagem');
      const fonte = await um('SELECT MIN(id) AS id FROM fonte_pagadora');
      if (!usuario || !categoria || !caraterTiss || !carater || !tipoItem || !checagem || !fonte)
        throw new Error(
          'O cliente de teste precisa de usuário, categoria, caráter, tipo de item e situação.',
        );
      const novoEst = (codigo: string) =>
        e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
           VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      const est = await novoEst(P);
      await novoEst(P2);
      const min = (t: string, v: Record<string, unknown>) => inserirMinimo(e, t, v, P);
      const pfPac = await min('pessoa_fisica', { nome: `PACIENTE SINTETICO ${COD('')}` });
      const paciente = await min('paciente', { pessoa_fisica_id: pfPac, situacao: 'ativo' });
      const pfProf = await min('pessoa_fisica', { nome: `PROFISSIONAL SINTETICO ${COD('')}` });
      const prof = await min('profissional', { pessoa_fisica_id: pfProf, tipo: 'corpo_clinico' });
      const atendimento = (n: string) =>
        min('atendimento', {
          estabelecimento_id: est,
          numero: `${P}-${n}`,
          paciente_id: paciente,
          categoria_atendimento_id: categoria,
          carater_atendimento_tiss_id: caraterTiss,
          fonte_pagadora_id: fonte,
          profissional_id: prof,
          entrada_em: H(6),
        });
      const atA = await atendimento('A');
      const atB = await atendimento('B');
      const ua = await min('unidade_assistencial', {
        estabelecimento_id: est,
        codigo: 'CC1',
        tipo_unidade: 'centro_cirurgico',
      });
      const uc = await min('unidade_cirurgica', {
        estabelecimento_id: est,
        unidade_assistencial_id: ua,
        funciona_24_horas: true,
      });
      const sala = await min('sala_cirurgica', {
        estabelecimento_id: est,
        unidade_cirurgica_id: uc,
        codigo: 'S1',
        situacao: 'ativa',
      });
      const grupo = await min('grupo_procedimento_cirurgico', {
        codigo: COD('G'),
        descricao: 'GRUPO SINTETICO',
      });
      const procedimento = await min('procedimento_cirurgico', {
        codigo: COD('P1'),
        descricao: 'PROCEDIMENTO SINTETICO',
        grupo_procedimento_cirurgico_id: grupo,
      });
      const principio = (n: string) =>
        min('principio_ativo', { codigo_dcb: `PF2012${n}`, descricao: `PRINCIPIO SINTETICO ${n}` });
      const paCef = await principio('1');
      const paVan = await principio('2');
      const cefazolina = await min('antimicrobiano', {
        codigo: COD('CEF'),
        descricao: 'CEFAZOLINA SINTETICA',
        principio_ativo_id: paCef,
      });
      const vancomicina = await min('antimicrobiano', {
        codigo: COD('VAN'),
        descricao: 'VANCOMICINA SINTETICA',
        principio_ativo_id: paVan,
      });
      const unidade = await min('unidade_medida', { codigo: COD('MG'), sigla: 'mgs' });
      const via = await min('via_de_uso', { codigo: COD('IV') });
      const unidadePresc = await min('unidade_prescricao', {
        codigo: COD('MG'),
        sigla: 'mgs',
        unidade_medida_id: unidade,
        fator_conversao: 1,
      });
      const itemCef = await min('item_prescritivel', {
        codigo: COD('ICEF'),
        descricao: 'CEFAZOLINA SINTETICA 2G',
        tipo_item_prescricao_id: tipoItem,
        principio_ativo_id: paCef,
      });
      let numero = 0;
      // A prescrição do atendimento com o item da cefazolina e o horário checado.
      const prescrever = async (at: number, administrado: Date, fim: Date | null) => {
        const pr = await min('prescricao', {
          estabelecimento_id: est,
          numero: 920120 + ++numero,
          paciente_id: paciente,
          atendimento_id: at,
          prescritor_profissional_id: prof,
          prescrito_em: H(6),
          vigencia_inicio_em: H(6),
          vigencia_fim_em: H(6, 0, 11),
        });
        const item = await min('prescricao_item', {
          prescricao_id: pr,
          sequencia: 1,
          tipo_item_prescricao_id: tipoItem,
          item_prescritivel_id: itemCef,
          via_de_uso_id: via,
          unidade_prescricao_id: unidadePresc,
          inicio_em: H(6),
          fim_em: fim,
          lancamento_profissional_id: prof,
        });
        await min('horario_administracao', {
          estabelecimento_id: est,
          atendimento_id: at,
          prescricao_id: pr,
          prescricao_item_id: item,
          previsto_em: administrado,
          situacao_checagem_id: checagem,
          quantidade_administrada: 2000,
          unidade_prescricao_id: unidadePresc,
          administrado_em: administrado,
          administrado_por_profissional_id: prof,
        });
      };
      await prescrever(atA, H(7, 30), H(12));
      await prescrever(atB, H(6, 30), null);
      const ato = async (at: number, n: string, incisao: Date | null, fim: Date | null, situacao: string) => {
        const id = await e.inserir(
          `INSERT INTO ato_cirurgico (estabelecimento_id, numero, atendimento_id, paciente_id, sala_cirurgica_id,
             carater_cirurgia_id, entrada_sala_em, inicio_cirurgia_em, fim_cirurgia_em, saida_sala_em, peso_kg,
             situacao, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 80, ?, ?)`,
          [est, `${P}-${n}`, at, paciente, sala, carater, H(7, 50), incisao, fim, fim, situacao, agora],
        );
        await e.inserir(
          `INSERT INTO ato_cirurgico_procedimento (ato_cirurgico_id, sequencia, procedimento_cirurgico_id, principal,
             criado_em) VALUES (?, 1, ?, TRUE, ?)`,
          [id, procedimento, agora],
        );
        return id;
      };
      return {
        usuario,
        procedimento,
        grupo,
        cefazolina,
        vancomicina,
        unidade,
        via,
        atoA: await ato(atA, 'A', H(8), H(10), 'realizado'),
        atoB: await ato(atB, 'B', H(8), H(10), 'realizado'),
        atoC: await ato(atA, 'C', null, null, 'em_andamento'),
      };
    });
    porta = new PortaProfilaxiaCirurgicaPropria(nucleo, CLIENTE);
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('cadastra o protocolo: janela de 90 min recusada na cefazolina; 120 aceita na vancomicina; desativar não apaga', async () => {
    const r = await porta.incluirProtocolo(ctx(), protocoloBase());
    protocoloCefazolina = Number(r['id']);
    await expect(
      porta.incluirProtocolo(ctx(), { ...protocoloBase(), antesMaximo: 90 }),
    ).rejects.toMatchObject(recusa422);
    const v = await porta.incluirProtocolo(ctx(), {
      grupo: m.grupo,
      antimicrobiano: m.vancomicina,
      dose: 15,
      dosePorKg: true,
      unidade: m.unidade,
      antesMaximo: 120,
      alternativaAlergia: true,
      ordem: 2,
      vigenciaInicio: '2030-01-01',
    });
    const lidos = await porta.protocolos(ctx());
    expect(lidos.protocolos.map((p) => [p.antimicrobiano, p.janelaMaxima, p.ativo])).toEqual([
      [m.cefazolina, 60, true],
      [m.vancomicina, 120, true],
    ]);
    expect(lidos.opcoes.antimicrobianos.find((a) => a.id === m.vancomicina)?.janelaLonga).toBe(true);
    await porta.ativarProtocolo(ctx(), Number(v['id']), { versao: 1, ativo: false });
    const [linha] = await ler('SELECT ativo, versao FROM protocolo_profilaxia_cirurgica WHERE id = ?', [
      v['id'],
    ]);
    expect(linha).toMatchObject({ ativo: 0, versao: 2 });
    await expect(
      porta.ativarProtocolo(ctx(), Number(v['id']), { versao: 1, ativo: true }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await porta.ativarProtocolo(ctx(), Number(v['id']), { versao: 2, ativo: true });
    const n = await ler(
      'SELECT COUNT(*) AS n FROM protocolo_profilaxia_cirurgica WHERE estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = ?)',
      [P],
    );
    expect(Number(n[0]?.['n'])).toBe(2);
  });

  it('audita o ato conforme e grava o avaliador; a nova auditoria deixa a anterior no histórico', async () => {
    const r = await porta.auditar(ctx(), m.atoA, {});
    expect(r).toMatchObject({
      situacao: 'conforme',
      minutosAntesIncisao: 30,
      protocolo: protocoloCefazolina,
      antimicrobiano: m.cefazolina,
    });
    let linhas = await auditorias(m.atoA);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      situacao: 'conforme',
      avaliavel: 1,
      droga_adequada: 1,
      dose_adequada: 1,
      momento_adequado: 1,
      via_adequada: 1,
      repique_adequado: 1,
      duracao_adequada: 1,
      protocolo: protocoloCefazolina,
      avaliador: m.usuario,
      avaliado: 1,
      excluida: 0,
    });
    await porta.auditar(ctx(), m.atoA, { justificativa: 'Reauditoria sintética da comissão' });
    linhas = await auditorias(m.atoA);
    expect(linhas.map((l) => [l['excluida'], l['situacao']])).toEqual([
      [1, 'conforme'],
      [0, 'conforme'],
    ]);
    expect(linhas[0]).toMatchObject({ excluido_por: m.usuario, versao: 2 });
    expect(linhas[1]?.['justificativa']).toBe('Reauditoria sintética da comissão');
  });

  it('a dose 90 minutos antes da incisão é não conforme; o ato sem incisão não é avaliável', async () => {
    const b = await porta.auditar(ctx(), m.atoB, {});
    expect(b.situacao).toBe('nao_conforme');
    expect(b.motivos).toContain('dose-fora-da-janela');
    expect((await auditorias(m.atoB))[0]).toMatchObject({ situacao: 'nao_conforme', momento_adequado: 0 });
    const c = await porta.auditar(ctx(), m.atoC, {});
    expect(c.situacao).toBe('nao_avaliavel');
    expect((await auditorias(m.atoC))[0]).toMatchObject({
      situacao: 'nao_avaliavel',
      avaliavel: 0,
      momento_adequado: null,
      avaliador: m.usuario,
    });
  });

  it('o painel do período conta as cirurgias com incisão e a conformidade', async () => {
    const p = await porta.painel(ctx(), { de: '2030-03-10', ate: '2030-03-10' });
    expect(p.cirurgias.map((x) => x.ato).sort()).toEqual([m.atoA, m.atoB].sort());
    expect(p.indicadores).toMatchObject({
      cirurgias: 2,
      auditadas: 2,
      conformes: 1,
      naoConformes: 1,
      momentoAdequado: 1,
      percentualConforme: 50,
    });
    await expect(porta.painel(ctx(), { de: '2030-03-11', ate: '2030-03-10' })).rejects.toMatchObject(
      recusa422,
    );
  });

  it('a sessão de outro estabelecimento recebe 404 sem escrita', async () => {
    const antes = (await auditorias(m.atoA)).length;
    await expect(porta.auditar(ctx(P2), m.atoA, {})).rejects.toMatchObject({ problema: { status: 404 } });
    expect((await auditorias(m.atoA)).length).toBe(antes);
    const outro = await porta.protocolos(ctx(P2));
    expect(outro.protocolos).toEqual([]);
  });
});
