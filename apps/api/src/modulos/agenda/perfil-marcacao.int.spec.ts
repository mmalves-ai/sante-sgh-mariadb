// Contrato de efeito dos perfis de marcação (02-AGE linha 46) contra o MariaDB real, no cliente de teste (f22_o1 por
// padrão). Massa SINTÉTICA própria (estabelecimento f394p, logins teste.f394p.*), idempotente; os registros do lote
// são limpos antes e depois. Prova: as linhas em perfil_marcacao, perfil_marcacao_escopo e perfil_marcacao_usuario
// (versão, exclusão lógica sem apagar), a trilha na mesma transação, as recusas do domínio e a trava na marcação:
// recusa fora do perfil, aceite dentro, usuário sem perfil no escopo atual e administrador que pode tudo.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PerfisMarcacaoPropria } from './perfil-marcacao.js';
import { instanteDe, PortaAgendaPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'f394p';
const LOGINS = { a: 'teste.f394p.a', b: 'teste.f394p.b', c: 'teste.f394p.c' } as const;
const FUSO = 'America/Sao_Paulo';
const DIA = '2030-03-12'; // terça-feira
const AGORA = instanteDe(FUSO, '2030-03-11', '09:00');
const CONVENIO = 9394;
const OUTRO = 9395;
const HORAS = ['08:00', '08:15', '08:30', '08:45'];
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('perfis de marcação (porta própria, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let perfis: PerfisMarcacaoPropria;
  let porta: PortaAgendaPropria;
  const ids = { est: 0, agenda: 0, a: 0, b: 0, c: 0, paciente: 0, fpA: 0, fpB: 0, esp: 0, perfil: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    const est = [ids.est];
    await e.executar(
      'DELETE pu FROM perfil_marcacao_usuario pu JOIN perfil_marcacao p ON p.id = pu.perfil_marcacao_id WHERE p.estabelecimento_id = ?',
      est,
    );
    await e.executar(
      'DELETE x FROM perfil_marcacao_escopo x JOIN perfil_marcacao p ON p.id = x.perfil_marcacao_id WHERE p.estabelecimento_id = ?',
      est,
    );
    await e.executar('DELETE FROM perfil_marcacao WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM marcacao_horario WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM horario_agenda WHERE estabelecimento_id = ?', est);
    await e.executar(
      'DELETE p FROM geracao_grade_periodo p JOIN geracao_grade g ON g.id = p.geracao_grade_id WHERE g.estabelecimento_id = ?',
      est,
    );
    await e.executar('DELETE FROM geracao_grade WHERE estabelecimento_id = ?', est);
    await e.executar(
      'DELETE x FROM agenda_escala x JOIN agenda_servico a ON a.id = x.agenda_servico_id WHERE a.estabelecimento_id = ?',
      est,
    );
    await e.executar(
      "DELETE FROM sequencia_negocio WHERE estabelecimento_id = ? AND tipo = 'marcacao_horario'",
      est,
    );
  };
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-f394p' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctxG = (login = LOGINS.a) => ({
    hospital: EST,
    login,
    correlacao: 'teste-f394p',
    chaveIdempotencia: `f394p-${randomUUID()}`,
  });
  const ctxPorta = (login: string, administrador = false) => ({
    rede: 'teste',
    hospital: EST,
    login,
    gestorDeAgendas: false,
    administrador,
    correlacao: 'teste-f394p',
    chaveIdempotencia: `f394p-${randomUUID()}`,
  });
  const marcar = (login: string, hora: string, convenio: number, administrador = false) =>
    porta.executar(ctxPorta(login, administrador), 'agenda.agendarConsulta', {
      agenda: ids.agenda,
      data: DIA,
      hora,
      paciente: ids.paciente,
      convenio,
      retorno: false,
      canal: 'telefone',
    });
  const perfilBase = () => ({
    codigo: 'central-f394p',
    descricao: 'Central sintética F394P',
    tipoPerfil: 'central',
    permiteEncaixe: false,
    ativo: true,
    recortes: [
      { dimensao: 'fonte_pagadora', alvo: ids.fpA, permitido: true },
      { dimensao: 'especialidade', alvo: ids.esp, permitido: true },
    ],
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f394p' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      for (const k of ['a', 'b', 'c'] as const)
        ids[k] = await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [LOGINS[k]],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [LOGINS[k], `USUARIO SINTETICO F394P ${k.toUpperCase()}`, agora],
        );
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        ['PROFISSIONAL SINTETICO F394P'],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        ['PROFISSIONAL SINTETICO F394P', agora],
      );
      const prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        ['f394p-consulta'],
        'INSERT INTO categoria_agenda (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['f394p-consulta', 'Sintético f394p', agora],
      );
      const agenda = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
          [ids.est, nome],
          `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em)
           VALUES (?, ?, ?, ?, 15, ?)`,
          [ids.est, nome, cat, prof, agora],
        );
      ids.agenda = await agenda('AGENDA SINTETICA F394P');
      const pp = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        ['PACIENTE SINTETICO F394P'],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        ['PACIENTE SINTETICO F394P', agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pp, 9394001, agora],
      );
      for (const [k, cod] of [
        ['fpA', CONVENIO],
        ['fpB', OUTRO],
      ] as const)
        ids[k] = await garantir(
          e,
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [String(cod)],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, criado_em) VALUES (?, ?, 'particular', ?)",
          [String(cod), `CONVENIO SINTETICO ${cod}`, agora],
        );
      ids.esp = await garantir(
        e,
        'SELECT id FROM especialidade_medica WHERE codigo = ?',
        ['939401'],
        'INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['939401', 'ESPECIALIDADE SINTETICA F394P', agora],
      );
      if (
        !(await e.uma(
          'SELECT id FROM agenda_especialidade WHERE agenda_servico_id = ? AND especialidade_medica_id = ?',
          [ids.agenda, ids.esp],
        ))
      )
        await e.inserir(
          'INSERT INTO agenda_especialidade (agenda_servico_id, especialidade_medica_id, criado_em) VALUES (?, ?, ?)',
          [ids.agenda, ids.esp, agora],
        );
      const dominio = (tabela: string, codigo: string, extra: Record<string, unknown> = {}) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, descricao, ${[...Object.keys(extra), 'criado_em'].join(', ')}) VALUES (?, ?, ${[
            ...Object.keys(extra),
            'x',
          ]
            .map(() => '?')
            .join(', ')})`,
          [codigo, `Sintético ${codigo}`, ...Object.values(extra), agora],
        );
      for (const sig of ['aguardando', 'confirmada', 'cancelada', 'falta'])
        if (!(await e.uma('SELECT id FROM situacao_marcacao WHERE significado = ? AND ativo', [sig])))
          await dominio('situacao_marcacao', `f394p-${sig}`, { significado: sig });
      for (const nat of ['primeira_vez', 'retorno', 'encaixe'])
        if (!(await e.uma('SELECT id FROM tipo_marcacao WHERE natureza = ? AND ativo', [nat])))
          await dominio('tipo_marcacao', `f394p-${nat}`, { natureza: nat });
      await dominio('canal_marcacao', 'telefone');
      for (const m of ['PAC-DESISTIU', 'PAC-OUTRA-DATA']) await dominio('motivo_cancelamento_operacao', m);
      await dominio('motivo_bloqueio_agenda', 'CONGRESSO');
      await limpar(e);
    });
    perfis = new PerfisMarcacaoPropria(nucleo, CLIENTE);
    porta = new PortaAgendaPropria(nucleo, CLIENTE, () => AGORA);
    await porta.executar(ctxPorta(LOGINS.a), 'agenda.gerarGrade', {
      agenda: ids.agenda,
      de: DIA,
      ate: DIA,
      duracao: '00:15',
      horarios: HORAS.map((hora) => ({ data: DIA, hora })),
      escala: [
        {
          semana: 3,
          duracao: '00:15',
          horaInicio: '08:00',
          horaFim: '09:00',
          intervaloInicio: null,
          intervaloFim: null,
        },
      ],
      semanas: ['F', 'F', 'T', 'F', 'F', 'F', 'F'],
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f394p' }, async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('cria o perfil com os recortes, recusa repetição e grava a trilha na mesma transação', async () => {
    await expect(
      perfis.salvar(ctxG(), {
        ...perfilBase(),
        recortes: [...perfilBase().recortes, { dimensao: 'fonte_pagadora', alvo: ids.fpA, permitido: false }],
      }),
    ).rejects.toMatchObject(recusada('recorte-repetido'));
    const r = await perfis.salvar(ctxG(), perfilBase());
    ids.perfil = r.resultado.perfil;
    await expect(perfis.salvar(ctxG(), { ...perfilBase(), recortes: [] })).rejects.toMatchObject(
      recusada('codigo-repetido'),
    );
    const [p] = await ler<{ codigo: string; tipo_perfil: string; versao: number; criado_por: number }>(
      'SELECT codigo, tipo_perfil, versao, criado_por FROM perfil_marcacao WHERE id = ?',
      [ids.perfil],
    );
    expect(p).toMatchObject({ codigo: 'CENTRAL-F394P', tipo_perfil: 'central' });
    expect([Number(p!.versao), Number(p!.criado_por)]).toEqual([1, ids.a]);
    const rs = await ler<{ tipo_escopo: string; sequencia: number }>(
      'SELECT tipo_escopo, sequencia FROM perfil_marcacao_escopo WHERE perfil_marcacao_id = ? AND excluido_em IS NULL ORDER BY sequencia',
      [ids.perfil],
    );
    expect(rs.map((x) => [x.tipo_escopo, Number(x.sequencia)])).toEqual([
      ['fonte_pagadora', 1],
      ['especialidade', 2],
    ]);
    const [t] = await ler<{ n: number }>(
      "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'perfil_marcacao' AND entidade_id = ?",
      [ids.perfil],
    );
    expect(Number(t!.n)).toBeGreaterThanOrEqual(1);
  });

  it('liga o usuário com vigência, recusa vigência invertida e a leitura mostra recortes e usuários', async () => {
    await expect(
      perfis.definirUsuario(ctxG(), {
        perfil: ids.perfil,
        acao: 'incluir',
        usuario: ids.b,
        vigenciaInicio: '2030-03-10',
        vigenciaFim: '2030-03-01',
      }),
    ).rejects.toMatchObject(recusada('vigencia-invertida'));
    await perfis.definirUsuario(ctxG(), {
      perfil: ids.perfil,
      acao: 'incluir',
      usuario: ids.b,
      vigenciaInicio: '2030-01-01',
      vigenciaFim: null,
    });
    const l = await perfis.listar({ hospital: EST, login: LOGINS.a });
    expect(l).toHaveLength(1);
    expect(l[0]!.recortes.map((r) => r.nome)).toEqual([
      `CONVENIO SINTETICO ${CONVENIO}`,
      'ESPECIALIDADE SINTETICA F394P',
    ]);
    expect(l[0]!.usuarios).toEqual([
      expect.objectContaining({ usuario: ids.b, vigenciaInicio: '2030-01-01', vigenciaFim: null }),
    ]);
  });

  it('na marcação: recusa fora do perfil, aceita dentro; sem perfil e administrador seguem no escopo', async () => {
    await expect(marcar(LOGINS.b, '08:00', OUTRO)).rejects.toMatchObject(recusada('fora-do-perfil-marcacao'));
    const [n0] = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM marcacao_horario WHERE estabelecimento_id = ? AND excluido_em IS NULL',
      [ids.est],
    );
    expect(Number(n0!.n)).toBe(0);
    await marcar(LOGINS.b, '08:00', CONVENIO);
    await marcar(LOGINS.c, '08:15', OUTRO);
    await marcar(LOGINS.b, '08:30', OUTRO, true);
    const ms = await ler<{ fonte_pagadora_id: number; responsavel_usuario_id: number }>(
      'SELECT fonte_pagadora_id, responsavel_usuario_id FROM marcacao_horario WHERE estabelecimento_id = ? AND excluido_em IS NULL ORDER BY id',
      [ids.est],
    );
    expect(ms.map((m) => [Number(m.fonte_pagadora_id), Number(m.responsavel_usuario_id)])).toEqual([
      [ids.fpA, ids.b],
      [ids.fpB, ids.c],
      [ids.fpB, ids.b],
    ]);
  });

  it('alterar retira o recorte por exclusão lógica; desligar o usuário não apaga e ele volta ao escopo atual', async () => {
    // Alteração sem a versão lida é recusada pelo esquema (sem controle de concorrência não grava).
    await expect(
      perfis.salvar(ctxG(), {
        ...perfilBase(),
        id: ids.perfil,
        recortes: [{ dimensao: 'especialidade', alvo: ids.esp, permitido: true }],
      }),
    ).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'entrada-invalida', campos: ['versao'] }),
    });
    await perfis.salvar(ctxG(), {
      ...perfilBase(),
      id: ids.perfil,
      versao: 1,
      recortes: [{ dimensao: 'especialidade', alvo: ids.esp, permitido: true }],
    });
    // Outro gestor com a versão velha (1) e a lista antiga: 409 conflito-versao, nada muda no banco.
    await expect(
      perfis.salvar(ctxG(), {
        ...perfilBase(),
        id: ids.perfil,
        versao: 1,
        descricao: 'Mudança de outro gestor',
      }),
    ).rejects.toMatchObject({
      problema: expect.objectContaining({ status: 409, codigo: 'conflito-versao' }),
    });
    const rs = await ler<{ tipo_escopo: string; excluido_em: unknown; excluido_por: number | null }>(
      'SELECT tipo_escopo, excluido_em, excluido_por FROM perfil_marcacao_escopo WHERE perfil_marcacao_id = ? ORDER BY sequencia',
      [ids.perfil],
    );
    expect(rs).toHaveLength(2);
    expect(rs[0]!.excluido_em).not.toBeNull();
    expect(Number(rs[0]!.excluido_por)).toBe(ids.a);
    expect(rs[1]!.excluido_em).toBeNull();
    const [p] = await ler<{ versao: number }>('SELECT versao FROM perfil_marcacao WHERE id = ?', [
      ids.perfil,
    ]);
    expect(Number(p!.versao)).toBe(2);
    await perfis.definirUsuario(ctxG(), { perfil: ids.perfil, acao: 'remover', usuario: ids.b });
    await expect(
      perfis.definirUsuario(ctxG(), { perfil: ids.perfil, acao: 'remover', usuario: ids.b }),
    ).rejects.toMatchObject(recusada('usuario-fora-do-perfil'));
    const us = await ler<{ excluido_em: unknown }>(
      'SELECT excluido_em FROM perfil_marcacao_usuario WHERE perfil_marcacao_id = ?',
      [ids.perfil],
    );
    expect(us).toHaveLength(1);
    expect(us[0]!.excluido_em).not.toBeNull();
    await marcar(LOGINS.b, '08:45', OUTRO);
  });
});
