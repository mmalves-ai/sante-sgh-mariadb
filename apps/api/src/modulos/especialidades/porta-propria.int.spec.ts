// Integração da porta própria das especialidades contra o MariaDB real (cliente f22_o2). Massa SINTÉTICA com o código
// "L0206E" (nenhuma pessoa real): uma parturiente internada, o médico com o vínculo e o CBO, uma prescrição vigente e
// outra cancelada, e os cadastros (tipo de parto, tipo de protocolo, exames oftalmológicos).
// Contrato de efeito do partograma: o primeiro registro abre o partograma do atendimento (com o responsável) e numera
// o registro; o segundo usa o mesmo partograma; a trilha vai na mesma transação. Recusas: outro estabelecimento,
// paciente divergente, valor fora da faixa (CHECK do banco) e as gravações que esperam o modelo ('modelo-pendente').
// A mesma bateria de leitura do partograma roda na memória e no banco. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { conferirPartograma } from '@sgh/dominio-pep';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import type { PortaEspecialidades } from './porta.js';
import { PortaEspecialidadesMemoria } from './porta-memoria.js';
import { PortaEspecialidadesPropria } from './porta-propria.js';
import type { NovoPontoPartograma } from './tipos.js';

const CLIENTE = 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0206E';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('porta própria das especialidades (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaEspecialidadesPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    paciente: 0,
    profissional: 0,
    atendimento: 0,
    internacao: 0,
    tipoParto: 0,
    tipoProtocolo: 0,
    grupoOft: 0,
    exameOft: 0,
    prescricao: 0,
    sexoF: 0,
  };
  let ctx: ContextoNucleo;
  const trilha: TrilhaDaGravacao = {
    estabelecimento: null,
    usuario: null,
    acao: 'inclusao',
    entidade: 'partograma_registro',
    entidadeId: null,
    correlacao: 'teste-02-06',
    dadosDepois: { tela: 'obstetricia' },
  };
  const ponto = (x: Partial<NovoPontoPartograma> = {}): NovoPontoPartograma => ({
    internacao: ids.internacao,
    prontuario: 920_206_101,
    paciente: ids.paciente,
    vinculo: ids.profissional,
    usuario: 'l0206.teste',
    em: '2026-11-20T08:00',
    dilatacaoCm: 4,
    alturaApresentacao: -2,
    bcf: 140,
    contracoes10min: 3,
    duracaoContracaoS: 40,
    bolsa: 'integra',
    liquido: null,
    paSistolica: 120,
    paDiastolica: 80,
    temperatura: 36.8,
    ocitocina: null,
    observacao: null,
    alertas: [],
    ...x,
  });

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar(
        'DELETE r FROM partograma_registro r JOIN partograma p ON p.id = r.partograma_id WHERE p.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('DELETE FROM partograma WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM registro_nascimento WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM prescricao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM usuario_vinculo_profissional WHERE estabelecimento_id = ?', [ids.est]);
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o2');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-06-esp' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      await limpar(e);
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0206.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0206.teste', 'USUARIO SINTETICO L0206', agora],
      );
      const cat = (tabela: string, codigo: string, extra = '', extraValor: unknown[] = []) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, descricao${extra ? `, ${extra}` : ''}, criado_em) VALUES (?, ?${extraValor.map(() => ', ?').join('')}, ?)`,
          [codigo, `${tabela.toUpperCase()} ${P}`, ...extraValor, agora],
        );
      const ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'internacao', ?)",
        [ids.est, `${P}-UA`, 'CENTRO OBSTETRICO SINTETICO', agora],
      );
      const ui = await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UI`],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?, 'enfermaria', ?)",
        [ids.est, ua, `${P}-UI`, 'OBSTETRICIA SINTETICA', agora],
      );
      const bloco = await garantir(
        e,
        'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'CO'],
        'INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, 'CO', 'BLOCO SINTETICO', agora],
      );
      const catAc = await garantir(
        e,
        'SELECT id FROM categoria_acomodacao WHERE codigo = ?',
        [`${P}-ENF`],
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, ?, 'enfermaria', ?)",
        [`${P}-ENF`, 'ENFERMARIA L0206', agora],
      );
      const acomodacao = await garantir(
        e,
        'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, '01'],
        `INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id,
           codigo, nome, quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [ids.est, bloco, ui, catAc, '01', 'SALA 01', agora],
      );
      const sit = await garantir(
        e,
        "SELECT id FROM situacao_leito WHERE situacao_base = 'livre' ORDER BY id LIMIT 1",
        [],
        "INSERT INTO situacao_leito (codigo, descricao, situacao_base, criado_em) VALUES (?, 'LIVRE', 'livre', ?)",
        [`${P}-LIVRE`, agora],
      );
      const leito = await garantir(
        e,
        'SELECT id FROM leito_hospitalar WHERE unidade_internacao_id = ? AND codigo = ?',
        [ui, 'A'],
        `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id,
           codigo, situacao_leito_id, criado_em) VALUES (?, ?, ?, ?, 'A', ?, ?)`,
        [ids.est, ui, acomodacao, bloco, sit, agora],
      );
      const tiss = await garantir(
        e,
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['L6'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L6', 'CARATER L0206', 'teste', ?)",
        [agora],
      );
      const catAt = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO L0206', 'internacao', ?)",
        [`${P}-INT`, agora],
      );
      const carater = await garantir(
        e,
        'SELECT id FROM carater_admissao WHERE codigo = ?',
        [`${P}-URG`],
        "INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, 'URGENCIA L0206', TRUE, ?)",
        [`${P}-URG`, agora],
      );
      const modal = await cat('modalidade_internacao', `${P}-OBS`);
      const esp = await cat('especialidade_medica', `${P}-GO`);
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA L0206', 'operadora', 'ativa', ?)",
        [`${P}-INT`, agora],
      );
      const sexoF = (ids.sexoF = await garantir(
        e,
        "SELECT id FROM sexo WHERE sigla = 'F'",
        [],
        "INSERT INTO sexo (codigo, descricao, sigla, criado_em) VALUES ('F', 'FEMININO', 'F', ?)",
        [agora],
      ));
      const pessoa = (nome: string, sexo: number | null) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, sexo_id, data_nascimento, criado_em) VALUES (?, ?, ?, ?)',
          [nome, sexo, '1996-04-12', agora],
        );
      const pp = await pessoa(`PARTURIENTE SINTETICA ${P}`, sexoF);
      const pm = await pessoa(`MEDICA SINTETICA ${P}`, null);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 920_206_101, agora],
      );
      ids.profissional = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      const cbo = await garantir(
        e,
        "SELECT id FROM ocupacao_cbo WHERE codigo_cbo = '225250'",
        [],
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, criado_em) VALUES ('225250', 'MEDICO GINECOLOGISTA E OBSTETRA', TRUE, ?)",
        [agora],
      );
      await garantir(
        e,
        'SELECT id FROM profissional_ocupacao WHERE profissional_id = ? AND ocupacao_cbo_id = ?',
        [ids.profissional, cbo],
        'INSERT INTO profissional_ocupacao (profissional_id, ocupacao_cbo_id, principal, criado_em) VALUES (?, ?, FALSE, ?)',
        [ids.profissional, cbo, agora],
      );
      await e.inserir(
        `INSERT INTO usuario_vinculo_profissional (usuario_id, estabelecimento_id, profissional_id, vigencia_inicio, criado_em)
         VALUES (?, ?, ?, '2026-01-01', ?)`,
        [ids.usuario, ids.est, ids.profissional, agora],
      );
      const entrada = new Date('2026-11-20T09:00:00Z');
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids.est, `${P}-AT1`, ids.paciente, catAt, tiss, fonte, ids.profissional, entrada, agora],
      );
      ids.internacao = await e.inserir(
        `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
           carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, leito_hospitalar_id, acomodacao_id,
           especialidade_medica_id, medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?)`,
        [ids.est, `${P}-IN1`, ids.atendimento, ids.paciente, entrada, carater, modal, ui, leito, acomodacao, esp,
          ids.profissional, fonte, agora],
      );
      const prescricao = (numero: number, situacao: string, suspensa: Date | null) =>
        e.inserir(
          `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
             situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, suspensa_em, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ids.est, numero, ids.paciente, ids.atendimento, ids.profissional, situacao, entrada,
            new Date('2026-11-20T13:00:00Z'), new Date('2026-11-21T13:00:00Z'), suspensa, agora],
        );
      ids.prescricao = await prescricao(920_206_001, 'vigente', null);
      await prescricao(920_206_002, 'cancelada', null);
      ids.tipoParto = await cat('tipo_parto', `${P}-NORMAL`);
      ids.tipoProtocolo = await cat('tipo_protocolo_oncologico', `${P}-QT`);
      ids.grupoOft = await cat('grupo_exame_oftalmologico', `${P}-G`);
      ids.exameOft = await cat('tipo_exame_oftalmologico', `${P}-TON`, 'grupo_exame_oftalmologico_id', [ids.grupoOft]);
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'teste-02-06-esp' };
    porta = new PortaEspecialidadesPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-06-esp' }, limpar);
    await nucleo.encerrar();
  });

  it('lê a internação aberta com o leito, a busca, o vínculo com o CBO, o relógio e os cadastros', async () => {
    const i = await porta.internacao(ctx, ids.internacao);
    expect(i).toMatchObject({
      internacao: ids.internacao,
      paciente: ids.paciente,
      prontuario: 920_206_101,
      sexo: 'F',
      bloco: 'CO',
      acomodacao: '01',
      leito: 'A',
      aberta: true,
      nascimento: '1996-04-12',
    });
    expect(i?.admissao).toBe('2026-11-20T06:00');
    expect((await porta.internacoes(ctx, 'PARTURIENTE SINTETICA')).itens.map((x) => x.internacao)).toEqual([ids.internacao]);
    expect((await porta.internacoes(ctx, '920206101')).itens).toHaveLength(1);
    // Outro estabelecimento não vê a internação.
    expect(await porta.internacao({ ...ctx, estabelecimento: ids.outroEst }, ids.internacao)).toBeNull();
    expect(await porta.vinculos(ctx, 'ignorado')).toEqual([{ vinculo: ids.profissional, cbo: '225250', ativo: true }]);
    expect((await porta.relogio(ctx)).agora).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const cad = await porta.cadastrosOftalmologia(ctx);
    expect(cad.exames.find((x) => x.codigo === ids.exameOft)?.grupo).toBe(ids.grupoOft);
    expect((await porta.tiposParto(ctx)).some((t) => t.codigo === ids.tipoParto)).toBe(true);
    expect((await porta.tiposProtocolo(ctx)).some((t) => t.codigo === ids.tipoProtocolo)).toBe(true);
    const ps = await porta.prescricoesDoDia(ctx, ids.internacao, ids.paciente, '2026-11-20');
    expect(ps).toEqual([{ id: ids.prescricao, inicio: '2026-11-20T10:00', fim: '2026-11-21T10:00', suspensa: false, itens: 0 }]);
  });

  it('partograma: contrato de efeito (abre o partograma, numera, trilha) e as recusas', async () => {
    const id1 = await porta.gravarSgh(ctx, trilha, (g) => g.registrarPartograma(ponto()));
    const id2 = await porta.gravarSgh(ctx, (r: number) => ({ ...trilha, entidadeId: r }), (g) =>
      g.registrarPartograma(ponto({ em: '2026-11-20T09:00', dilatacaoCm: 6, bcf: 100, liquido: 'meconial' })),
    );
    const linhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-06-esp' }, (l) =>
      l.consultar(
        `SELECT r.id, r.sequencia, r.versao, r.liquido_amniotico, p.id AS partograma, p.situacao,
                p.responsavel_profissional_id, p.atendimento_id
           FROM partograma_registro r JOIN partograma p ON p.id = r.partograma_id
          WHERE p.estabelecimento_id = ? ORDER BY r.sequencia`,
        [ids.est],
      ),
    );
    expect(linhas.map((l) => [Number(l['id']), Number(l['sequencia']), Number(l['versao'])])).toEqual([
      [id1, 1, 1],
      [id2, 2, 1],
    ]);
    expect(new Set(linhas.map((l) => Number(l['partograma']))).size).toBe(1);
    expect(linhas[0]).toMatchObject({ situacao: 'aberto' });
    expect(Number(linhas[0]!['responsavel_profissional_id'])).toBe(ids.profissional);
    expect(Number(linhas[0]!['atendimento_id'])).toBe(ids.atendimento);
    expect(linhas[1]!['liquido_amniotico']).toBe('meconial_fluido');
    const t = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-02-06-esp' }, (l) =>
      l.uma<{ n: unknown }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'partograma_registro' AND entidade_id = ? AND estabelecimento_id = ?",
        [id2, ids.est],
      ),
    );
    expect(Number(t?.n)).toBe(1);
    // Leitura com os alertas recalculados pelo domínio (bradicardia e meconial).
    const lidos = await porta.partograma(ctx, ids.internacao);
    expect(lidos.map((x) => x.em)).toEqual(['2026-11-20T08:00', '2026-11-20T09:00']);
    expect(lidos[1]!.liquido).toBe('meconial');
    expect(lidos[1]!.alertas.join(' ')).toMatch(/bradicardia/);
    expect(lidos[0]!.por).toBe('l0206.teste');
    // Recusas: outro estabelecimento, paciente divergente, valor fora da faixa (CHECK), modelo pendente.
    const recusa = async (c: ContextoNucleo, x: NovoPontoPartograma) =>
      codigoDe(await porta.gravarSgh(c, trilha, (g) => g.registrarPartograma(x)).catch((e: unknown) => e));
    expect(await recusa({ ...ctx, estabelecimento: ids.outroEst }, ponto())).toBe('registro-inexistente');
    expect(await recusa(ctx, ponto({ paciente: ids.paciente + 999_999 }))).toBe('paciente-divergente');
    expect(await recusa(ctx, ponto({ dilatacaoCm: 12 }))).not.toBe('');
    const pend = await porta
      .gravarSgh(ctx, trilha, (g) => g.registrarOrdem({ ...ponto(), formula: 'F', volumeMl: 10, horarios: [], preparoEm: '', validadeEm: '', lote: null, observacao: null }))
      .catch((e: unknown) => e);
    expect(codigoDe(pend)).toBe('modelo-pendente');
    expect((await porta.partograma(ctx, ids.internacao)).length).toBe(2);
  });

  it.each([
    ['memória', () => new PortaEspecialidadesMemoria(() => new Date(2026, 9, 25, 15, 0, 0)) as PortaEspecialidades],
    ['banco', () => porta as PortaEspecialidades],
  ])('%s: o registro do partograma volta na leitura com o mesmo formato', async (_nome, fabrica) => {
    const p = fabrica();
    const memoria = p.destino === 'memoria';
    const c = memoria ? { cliente: '', estabelecimento: null, usuario: null, correlacao: 't' } : ctx;
    const internacao = memoria ? 950_101 : ids.internacao;
    const paciente = memoria ? 99_601 : ids.paciente;
    const antes = (await p.partograma(c, internacao)).length;
    await p.gravarSgh(c, trilha, (g) =>
      g.registrarPartograma(ponto({ internacao, paciente, em: '2026-11-20T10:00', dilatacaoCm: 7 })),
    );
    const depois = await p.partograma(c, internacao);
    expect(depois.length).toBe(antes + 1);
    expect(Object.keys(depois.at(-1)!).sort()).toEqual(
      [
        'id', 'em', 'dilatacaoCm', 'alturaApresentacao', 'bcf', 'contracoes10min', 'duracaoContracaoS', 'bolsa',
        'liquido', 'paSistolica', 'paDiastolica', 'temperatura', 'ocitocina', 'observacao', 'alertas', 'por',
        'registradoEm',
      ].sort(),
    );
    expect(depois.at(-1)!.dilatacaoCm).toBe(7);
  });
  it('recém-nascido sem peso, Apgar e idade gestacional: os campos e as classificações voltam null', async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-02-06-esp-rn' }, (e) =>
      e.inserir(
        `INSERT INTO registro_nascimento (estabelecimento_id, mae_paciente_id, mae_atendimento_id, nascido_em,
           tipo_parto_id, sexo_id, responsavel_profissional_id, origem, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'migracao', ?)`,
        [ids.est, ids.paciente, ids.atendimento, new Date('2026-11-20T15:00:00Z'), ids.tipoParto, ids.sexoF,
          ids.profissional, new Date()],
      ),
    );
    const [rn] = await porta.recemNascidos(ctx, ids.internacao);
    expect(rn).toMatchObject({
      pesoG: null,
      apgar1: null,
      apgar5: null,
      igSemanas: null,
      igDias: null,
      classificacaoPeso: null,
      classificacaoApgar: null,
      classificacaoIg: null,
      sexo: 'F',
    });
    expect(await porta.recemNascidos({ ...ctx, estabelecimento: ids.outroEst }, ids.internacao)).toEqual([]);
  });

  it.each([
    ['memória', () => new PortaEspecialidadesMemoria(() => new Date(2026, 9, 25, 15, 0, 0)) as PortaEspecialidades],
    ['banco', () => porta as PortaEspecialidades],
  ])('%s: o ponto à direita da linha de alerta volta com o alerta da gravação', async (_nome, fabrica) => {
    const p = fabrica();
    const memoria = p.destino === 'memoria';
    const c = memoria ? { cliente: '', estabelecimento: null, usuario: null, correlacao: 't' } : ctx;
    const internacao = memoria ? 950_102 : ids.internacao;
    const paciente = memoria ? 99_602 : ids.paciente;
    const faseAtivaCm = 4;
    // O caminho do controller: os alertas da gravação vêm do domínio sobre os registros anteriores.
    const gravar = async (x: Partial<NovoPontoPartograma>) => {
      const anteriores = await p.partograma(c, internacao, faseAtivaCm);
      const e = ponto({ internacao, paciente, ...x });
      const { alertas } = conferirPartograma({ ...e, observacao: e.observacao ?? undefined }, {
        admissao: '2026-11-20T00:00',
        agora: '2026-11-21T00:00',
        anteriores,
        faseAtivaCm,
      });
      await p.gravarSgh(c, trilha, (g) => g.registrarPartograma({ ...e, alertas }));
      return alertas;
    };
    if (!(await p.partograma(c, internacao, faseAtivaCm)).some((x) => x.em === '2026-11-20T08:00'))
      await gravar({ em: '2026-11-20T08:00', dilatacaoCm: 4 });
    // Fase ativa às 08:00 com 4 cm; às 14:00 a linha de alerta espera 10 cm e a de ação 6 cm: 6 cm fica entre elas.
    const gravados = await gravar({ em: '2026-11-20T14:00', dilatacaoCm: 6 });
    expect(gravados.join(' ')).toMatch(/linha de alerta/);
    const lido = (await p.partograma(c, internacao, faseAtivaCm)).find((x) => x.em === '2026-11-20T14:00');
    expect(lido?.alertas).toEqual(gravados);
  });
});
