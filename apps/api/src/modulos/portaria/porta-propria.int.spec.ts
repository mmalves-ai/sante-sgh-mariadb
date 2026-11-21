// Integração da porta própria da portaria contra o MariaDB real (cliente f22_o2, já criado pela obra da onda 2). Massa
// SINTÉTICA com códigos "L0212" (nenhuma pessoa real). Contrato de efeito de cada gravação: linhas, versão e trilha;
// e as recusas (já em visita, saída repetida, conflito de versão da regra e do terminal, bloqueio revogado duas vezes,
// outro estabelecimento, modelo pendente). No fim, a massa de negócio é apagada; ficam o estabelecimento, o usuário e
// os domínios de teste, que a trilha (só inclusão) referencia. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { civil } from '../exames/relogio.js';
import { PortaPortariaPropria } from './porta-propria.js';
import type { NovoBloqueioVisita } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0212';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

function codigoDe(e: unknown): string | null {
  return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : null;
}

async function recusada(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return codigoDe(e) ?? String(e);
  }
}

describe.skipIf(SEM_BANCO)('porta própria da portaria (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPortariaPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    internacao: 0,
    atendimento: 0,
    paciente: 0,
    tipoVisitante: 0,
    visitadoPaciente: 0,
    visitadoSetor: 0,
    cracha: 0,
    biometria: 0,
    modelo: 0,
    setor: 0,
    motivoPedido: 0,
  };
  let ctx: ContextoNucleo;
  let outro: ContextoNucleo;
  const agoraLocal = () => {
    const c = civil(new Date());
    return `${c.data}T${c.hhmm.slice(0, 2)}:${c.hhmm.slice(2, 4)}`;
  };
  const trilha =
    (entidade: string) =>
    (r: unknown): TrilhaDaGravacao => ({
      estabelecimento: ctx.estabelecimento,
      usuario: ctx.usuario,
      acao: 'operacao',
      entidade,
      entidadeId: typeof r === 'number' ? r : ((r as { id?: number })?.id ?? null),
      dadosDepois: { evento: 'teste-0212' },
      correlacao: 'teste-0212',
    });

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar('DELETE FROM visita WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outroEst]);
      await e.executar('DELETE FROM cracha_visitante WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outroEst]);
      await e.executar('DELETE FROM bloqueio_visitante WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outroEst]);
      await e.executar(
        'DELETE a FROM acompanhante_internacao a JOIN internacao i ON i.id = a.internacao_id WHERE i.estabelecimento_id = ?',
        [ids.est],
      );
      await e.executar('DELETE FROM regra_visita_unidade WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outroEst]);
      await e.executar(
        'DELETE t FROM terminal_acesso t JOIN ponto_acesso p ON p.id = t.ponto_acesso_id WHERE p.estabelecimento_id IN (?, ?)',
        [ids.est, ids.outroEst],
      );
      await e.executar('DELETE FROM ponto_acesso WHERE estabelecimento_id IN (?, ?) AND codigo <> ?', [
        ids.est,
        ids.outroEst,
        `${P}-PORT`,
      ]);
      await e.executar("DELETE FROM pessoa_portaria WHERE numero_documento LIKE 'L0212-%'");
      await e.executar("DELETE FROM arquivo WHERE finalidade = 'foto_visitante' AND chave_armazenamento LIKE 'visitante/l0212-%'");
    })();

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-12' }, async (e) => {
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
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['l0212.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0212.teste', 'USUARIO SINTETICO L0212', agora],
      );
      await limpar(e);
      await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
      const dom = (tabela: string, codigo: string, extraCol: string, extraVal: unknown) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, descricao${extraCol ? `, ${extraCol}` : ''}, criado_em) VALUES (?, ?${extraCol ? ', ?' : ''}, ?)`,
          extraCol ? [codigo, `${codigo} SINTETICO`, extraVal, agora] : [codigo, `${codigo} SINTETICO`, agora],
        );
      ids.tipoVisitante = await dom('tipo_visitante', `${P}-VIS`, 'categoria', 'visitante');
      ids.visitadoPaciente = await dom('tipo_visitado', `${P}-PAC`, 'alvo', 'paciente');
      ids.visitadoSetor = await dom('tipo_visitado', `${P}-SET`, 'alvo', 'setor');
      ids.cracha = await dom('forma_identificacao_visitante', `${P}-CRA`, 'exige_cracha', true);
      ids.biometria = await dom('forma_identificacao_visitante', `${P}-BIO`, 'biometrica', true);
      for (const m of ['pedido', 'clinico']) await dom('motivo_bloqueio_visita', m, 'abrangencia', 'ambos');
      ids.motivoPedido = await dom('motivo_bloqueio_visita', 'pedido', 'abrangencia', 'ambos');
      ids.setor = await garantir(
        e,
        'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-FARM`],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, sigla, tipo, criado_em) VALUES (?, ?, 'FARMACIA SINTETICA L0212', 'FL0212', 'apoio_tecnico', ?)",
        [ids.est, `${P}-FARM`, agora],
      );
      await dom('tipo_documento_identificacao', 'rg', '', null);
      const fab = await dom('fabricante_terminal_acesso', `${P}-FAB`, '', null);
      ids.modelo = await garantir(
        e,
        'SELECT id FROM modelo_terminal_acesso WHERE codigo = ?',
        [`${P}-CAT`],
        "INSERT INTO modelo_terminal_acesso (codigo, descricao, fabricante_terminal_acesso_id, tipo, criado_em) VALUES (?, 'CATRACA L0212', ?, 'catraca', ?)",
        [`${P}-CAT`, fab, agora],
      );
      await garantir(
        e,
        'SELECT id FROM ponto_acesso WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-PORT`],
        "INSERT INTO ponto_acesso (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, 'PORTARIA L0212', 'portaria', ?)",
        [ids.est, `${P}-PORT`, agora],
      );
      // Internação ativa (massa sintética mínima).
      const ua = await garantir(
        e,
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, ?, 'internacao', ?)",
        [ids.est, `${P}-UA`, 'INTERNACAO SINTETICA', agora],
      );
      const ui = await garantir(
        e,
        'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, `${P}-UI`],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, ?, 'enfermaria', ?)",
        [ids.est, ua, `${P}-UI`, 'ENFERMARIA SINTETICA', agora],
      );
      const bloco = await garantir(
        e,
        'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'B1'],
        'INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
        [ids.est, 'B1', 'BLOCO SINTETICO', agora],
      );
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_acomodacao WHERE codigo = ?',
        [`${P}-ENF`],
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, ?, 'enfermaria', ?)",
        [`${P}-ENF`, 'ENFERMARIA L0212', agora],
      );
      const acomodacao = await garantir(
        e,
        'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?',
        [ids.est, 'ENF1'],
        `INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id,
           codigo, nome, quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, ?, ?, 2, ?)`,
        [ids.est, bloco, ui, cat, 'ENF1', 'ENFERMARIA 1', agora],
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
        [ui, '01'],
        `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id,
           codigo, situacao_leito_id, ativo, criado_em) VALUES (?, ?, ?, ?, '01', ?, TRUE, ?)`,
        [ids.est, ui, acomodacao, bloco, sit, agora],
      );
      const catalogo = (sel: string, p: unknown[], ins: string, pi: unknown[]) => garantir(e, sel, p, ins, pi);
      const tiss = await catalogo(
        'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
        ['M2'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('M2', 'CARATER L0212', 'teste', ?)",
        [agora],
      );
      const catAt = await catalogo(
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO L0212', 'internacao', ?)",
        [`${P}-INT`, agora],
      );
      const carater = await catalogo(
        'SELECT id FROM carater_admissao WHERE codigo = ?',
        [`${P}-ELE`],
        "INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, 'ELETIVA L0212', FALSE, ?)",
        [`${P}-ELE`, agora],
      );
      const modal = await catalogo(
        'SELECT id FROM modalidade_internacao WHERE codigo = ?',
        [`${P}-CLI`],
        "INSERT INTO modalidade_internacao (codigo, descricao, criado_em) VALUES (?, 'CLINICA L0212', ?)",
        [`${P}-CLI`, agora],
      );
      const esp = await catalogo(
        'SELECT id FROM especialidade_medica WHERE codigo = ?',
        [`${P}-CLM`],
        "INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, 'CLINICA MEDICA L0212', ?)",
        [`${P}-CLM`, agora],
      );
      const fonte = await catalogo(
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}-INT`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA L0212 INT', 'operadora', 'ativa', ?)",
        [`${P}-INT`, agora],
      );
      const pessoa = (nome: string, nasc: string | null) =>
        garantir(e, 'SELECT id FROM pessoa_fisica WHERE nome = ?', [nome], 'INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, ?, ?)', [
          nome,
          nasc,
          agora,
        ]);
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`, '1950-03-10');
      const pm = await pessoa(`MEDICO SINTETICO ${P}`, null);
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
        [pp, 910_212_001, agora],
      );
      const prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pm, agora],
      );
      const entrada = new Date(Date.now() - 2 * 86_400_000);
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids.est, `${P}-AT1`, ids.paciente, catAt, tiss, fonte, prof, entrada, agora],
      );
      ids.internacao = await e.inserir(
        `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada,
           carater_admissao_id, modalidade_internacao_id, unidade_internacao_id, leito_hospitalar_id, acomodacao_id,
           especialidade_medica_id, medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?)`,
        [ids.est, `${P}-IN1`, ids.atendimento, ids.paciente, entrada, carater, modal, ui, leito, acomodacao, esp, prof, fonte, agora],
      );
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'teste-02-12' };
    outro = { ...ctx, estabelecimento: ids.outroEst };
    porta = new PortaPortariaPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-12' }, async (e) => {
      await limpar(e);
      await e.executar('DELETE FROM setor_funcional WHERE id = ?', [ids.setor]);
      await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
    });
    await nucleo.encerrar();
  });

  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-0212' }, (l) => l.uma<T & Record<string, unknown>>(sql, p));

  const visitante = (doc: string, extra: Partial<{ foto: { chave: string; tipoMime: string; tamanho: number; hash: string } }> = {}) =>
    porta.gravarSgh(ctx, trilha('pessoa_portaria'), (g) =>
      g.registrarVisitante({
        nome: `VISITANTE SINTETICO ${doc}`,
        nomeBusca: `VISITANTE SINTETICO ${doc}`,
        tipoDocumento: 'rg',
        documento: doc,
        nascimento: '1980-05-01',
        telefone: null,
        tipoVisitante: ids.tipoVisitante,
        foto: extra.foto ?? null,
        reterAte: '2027-12-31',
        usuario: 'l0212.teste',
      }),
    );

  const visitaAOutroDestino = (pessoa: number, cracha: string, local: string, c: ContextoNucleo = ctx) =>
    porta.gravarSgh(c, trilha('visita'), (g) =>
      g.registrarVisita(
        {
          visitante: pessoa,
          destino: { tipo: 'outro', local },
          tipoVisitado: ids.visitadoSetor,
          identificacao: ids.cracha,
          cracha,
          entrada: agoraLocal(),
          validoAte: agoraLocal(),
          excecao: null,
          reterAte: '2027-12-31',
          usuario: 'l0212.teste',
          chave: null,
        },
        () => ({ permitida: true, papel: 'visitante' }),
      ),
    );

  const visitaAoPaciente = (pessoa: number, cracha: string, c: ContextoNucleo = ctx) =>
    porta.gravarSgh(c, trilha('visita'), (g) =>
      g.registrarVisita(
        {
          visitante: pessoa,
          destino: { tipo: 'paciente', internacao: ids.internacao, paciente: ids.paciente, bloco: `${P}-UI`, acomod: 'ENF1', leito: '01' },
          tipoVisitado: ids.visitadoPaciente,
          identificacao: ids.cracha,
          cracha,
          entrada: agoraLocal(),
          validoAte: agoraLocal(),
          excecao: null,
          reterAte: '2027-12-31',
          usuario: 'l0212.teste',
          chave: null,
        },
        (r) =>
          r.bloqueios.length > 0
            ? { permitida: false, recusa: 'bloqueio', mensagem: 'Visita bloqueada.' }
            : { permitida: true, papel: r.acompanhante === pessoa ? 'acompanhante' : 'visitante' },
      ),
    );

  it('domínios com o significado do banco e o internado com a unidade e o leito', async () => {
    const d = await porta.dominios(ctx);
    expect(d.tiposVisitado.find((t) => t.codigo === ids.visitadoPaciente)?.paciente).toBe(true);
    expect(d.tiposVisitado.find((t) => t.codigo === ids.visitadoSetor)?.paciente).toBe(false);
    expect(d.identificacoes.find((t) => t.codigo === ids.biometria)?.biometrica).toBe(true);
    expect(d.identificacoes.find((t) => t.codigo === ids.cracha)?.biometrica).toBe(false);
    const i = await porta.internado(ctx, ids.internacao);
    expect(i).toMatchObject({ paciente: ids.paciente, unidade: `${P}-UI`, acomod: 'ENF1', leito: 'ENF1-01', isolamento: false });
    expect((await porta.internados(ctx)).map((x) => x.internacao)).toContain(ids.internacao);
    expect(await porta.internado(outro, ids.internacao)).toBeNull();
    expect((await porta.unidades(ctx)).map((u) => u.unidade)).toContain(`${P}-UI`);
  });

  it('visitante: inclui pelo documento, atualiza o mesmo documento (versão) e grava a trilha', async () => {
    const r1 = await visitante('L0212-RG1', {
      foto: { chave: 'visitante/l0212-00000000-0000-0000-0000-000000000001.jpg', tipoMime: 'image/jpeg', tamanho: 10, hash: 'a'.repeat(64) },
    });
    expect(r1).toMatchObject({ novo: true, fotoAnterior: null });
    const r2 = await visitante('L0212-RG1', {
      foto: { chave: 'visitante/l0212-00000000-0000-0000-0000-000000000002.jpg', tipoMime: 'image/jpeg', tamanho: 12, hash: 'b'.repeat(64) },
    });
    expect(r2).toEqual({ id: r1.id, novo: false, fotoAnterior: 'visitante/l0212-00000000-0000-0000-0000-000000000001.jpg' });
    const linha = await ler<{ versao: number; numero_documento: string }>('SELECT versao, numero_documento FROM pessoa_portaria WHERE id = ?', [r1.id]);
    expect(Number(linha?.versao)).toBe(2);
    const t = await ler<{ total: number }>(
      "SELECT COUNT(*) AS total FROM trilha_auditoria WHERE entidade = 'pessoa_portaria' AND entidade_id = ? AND estabelecimento_id = ?",
      [r1.id, ids.est],
    );
    expect(Number(t?.total)).toBeGreaterThanOrEqual(2);
    const lido = await porta.visitante(ctx, r1.id);
    expect(lido).toMatchObject({ tipoDocumento: 'rg', documento: 'L0212-RG1', tipoVisitante: ids.tipoVisitante, nascimento: '1980-05-01' });
    expect(await porta.foto(ctx, r1.id)).toBe('visitante/l0212-00000000-0000-0000-0000-000000000002.jpg');
    expect((await porta.buscarVisitantes(ctx, { documento: { tipo: 'rg', numero: 'L0212-RG1' }, nomeBusca: null })).map((v) => v.id)).toEqual([r1.id]);
    expect(await recusada(porta.gravarSgh(ctx, trilha('pessoa_portaria'), (g) => g.expurgarVisitantes({ hoje: '2030-01-01', usuario: 'x', teto: 1 })))).toBe(
      'modelo-pendente',
    );
  });

  it('visita ao paciente: crachá emitido, uma visita aberta por visitante, saída uma vez só', async () => {
    const { id: pessoa } = await visitante('L0212-RG2');
    const v = await visitaAoPaciente(pessoa, 'L0212CRACHA01');
    expect(v).toMatchObject({ papel: 'visitante', repetida: false });
    const linha = await ler<{ situacao: string; cracha: string; cs: string; entrada_usuario_id: number }>(
      `SELECT v.situacao, c.numero AS cracha, c.situacao AS cs, v.entrada_usuario_id FROM visita v
         JOIN cracha_visitante c ON c.id = v.cracha_visitante_id WHERE v.id = ?`,
      [v.id],
    );
    expect(linha).toMatchObject({ situacao: 'em_andamento', cracha: 'L0212CRACHA01', cs: 'em_uso' });
    expect(Number(linha?.entrada_usuario_id)).toBe(ids.usuario);
    const aberta = (await porta.abertas(ctx)).find((x) => x.id === v.id);
    expect(aberta).toMatchObject({ visitante: pessoa, internacao: ids.internacao, cracha: 'L0212CRACHA01', saida: null });
    expect(aberta!.validoAte > aberta!.entrada).toBe(true);
    expect(await recusada(visitaAoPaciente(pessoa, 'L0212CRACHA02'))).toBe('ja-em-visita');
    // Outro estabelecimento não vê nem encerra.
    expect(await porta.visita(outro, v.id)).toBeNull();
    const encerrar = (c: ContextoNucleo) =>
      porta.gravarSgh(c, trilha('visita'), (g) => g.encerrarVisita({ id: v.id, saida: agoraLocal(), origem: 'portaria', usuario: 'x' }));
    expect(await recusada(encerrar(outro))).toBe('nao-encontrado');
    await encerrar(ctx);
    const fim = await ler<{ situacao: string; cs: string; versao: number }>(
      `SELECT v.situacao, v.versao, c.situacao AS cs FROM visita v JOIN cracha_visitante c ON c.id = v.cracha_visitante_id WHERE v.id = ?`,
      [v.id],
    );
    expect(fim).toMatchObject({ situacao: 'encerrada', cs: 'inativo' });
    expect(Number(fim?.versao)).toBe(2);
    expect(await recusada(encerrar(ctx))).toBe('visita-encerrada');
    const periodo = await porta.visitasDoPeriodo(ctx, { internacao: ids.internacao, unidade: null, de: '2020-01-01', ate: '2099-12-31' });
    expect(periodo.map((x) => x.id)).toContain(v.id);
  });

  it('visita a outro destino: o setor do estabelecimento; o local que não é setor aguarda o modelo', async () => {
    const { id: pessoa } = await visitante('L0212-RG6');
    expect(await recusada(visitaAOutroDestino(pessoa, 'L0212CRACHA20', 'ALMOXARIFADO INEXISTENTE'))).toBe('modelo-pendente');
    const v = await visitaAOutroDestino(pessoa, 'L0212CRACHA21', 'FARMACIA SINTETICA L0212');
    const linha = await ler<{ setor_funcional_id: number; paciente_id: number | null }>(
      'SELECT setor_funcional_id, paciente_id FROM visita WHERE id = ?',
      [v.id],
    );
    expect(Number(linha?.setor_funcional_id)).toBe(ids.setor);
    expect(linha?.paciente_id).toBeNull();
    expect((await porta.visita(ctx, v.id))?.local).toBe('FARMACIA SINTETICA L0212');
    await porta.gravarSgh(ctx, trilha('visita'), (g) => g.encerrarVisita({ id: v.id, saida: agoraLocal(), origem: 'portaria', usuario: 'x' }));
  });

  it('reenvio do mesmo pedido (Idempotency-Key): a mesma visita, marcada repetida, sem gravar de novo', async () => {
    const { id: pessoa } = await visitante('L0212-RG7');
    const pedido = `t0212-visita-${Date.now()}`;
    const comPedido = () => ({ ...ctx, chavePedido: pedido });
    const v1 = await visitaAOutroDestino(pessoa, 'L0212CRACHA30', `${P}-FARM`, comPedido());
    expect(v1.repetida).toBe(false);
    const v2 = await visitaAOutroDestino(pessoa, 'L0212CRACHA30', `${P}-FARM`, comPedido());
    expect(v2).toEqual({ ...v1, repetida: true });
    const total = await ler<{ total: number }>('SELECT COUNT(*) AS total FROM visita WHERE pessoa_portaria_id = ?', [pessoa]);
    expect(Number(total?.total)).toBe(1);
    await porta.gravarSgh(ctx, trilha('visita'), (g) => g.encerrarVisita({ id: v1.id, saida: agoraLocal(), origem: 'portaria', usuario: 'x' }));
  });

  it('visitante barrado: bloqueio da pessoa, cadastro restrito e bloqueio do paciente sem atendimento', async () => {
    const { id: barrado } = await visitante('L0212-RG8');
    const { id: restrito } = await visitante('L0212-RG9');
    const { id: livre } = await visitante('L0212-RG10');
    const bloqueio = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-bloqueio-0212' }, async (e) => {
      const agora = new Date();
      const inicio = new Date(Date.now() - 3_600_000);
      await e.inserir(
        `INSERT INTO bloqueio_visitante (estabelecimento_id, abrangencia, pessoa_portaria_id, motivo_bloqueio_visita_id,
           inicio_em, determinante_usuario_id, criado_em) VALUES (?, 'pessoa', ?, ?, ?, ?, ?)`,
        [ids.est, barrado, ids.motivoPedido, inicio, ids.usuario, agora],
      );
      await e.executar(
        "UPDATE pessoa_portaria SET situacao = 'restrito', restricao_motivo = 'MOTIVO SINTETICO L0212' WHERE id = ?",
        [restrito],
      );
      return e.inserir(
        `INSERT INTO bloqueio_visitante (estabelecimento_id, abrangencia, paciente_id, motivo_bloqueio_visita_id,
           inicio_em, determinante_usuario_id, criado_em) VALUES (?, 'paciente', ?, ?, ?, ?, ?)`,
        [ids.est, ids.paciente, ids.motivoPedido, inicio, ids.usuario, agora],
      );
    });
    // A pessoa barrada no estabelecimento não entra em destino nenhum.
    expect(await recusada(visitaAOutroDestino(barrado, 'L0212CRACHA40', `${P}-FARM`))).toBe('visitante-bloqueado');
    expect(await recusada(visitaAoPaciente(barrado, 'L0212CRACHA41'))).toBe('visitante-bloqueado');
    // O cadastro restrito também não entra.
    expect(await recusada(visitaAoPaciente(restrito, 'L0212CRACHA42'))).toBe('visitante-bloqueado');
    // O bloqueio do paciente sem atendimento informado vale na internação dele.
    expect(await recusada(visitaAoPaciente(livre, 'L0212CRACHA43'))).toBe('bloqueio');
    expect((await porta.bloqueios(ctx, ids.internacao)).map((b) => b.id)).toContain(bloqueio);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-bloqueio-0212' }, async (e) => {
      await e.executar('DELETE FROM bloqueio_visitante WHERE id = ? OR pessoa_portaria_id = ?', [bloqueio, barrado]);
    });
    expect(await recusada(visitaAOutroDestino(livre, 'L0212CRACHA44', `${P}-FARM`))).toBeNull();
  });

  it('regra da unidade pela versão; o que o modelo ainda não guarda é recusado', async () => {
    const base = {
      unidade: `${P}-UI`,
      horaInicio: '10:00',
      horaFim: '21:00',
      maxSimultaneos: 3,
      idadeMinima: 12,
      uti: false,
      isolamento: 'orientar' as const,
      duracaoMaxMin: 120,
      observacao: null,
      usuario: 'x',
    };
    const gravar = (r: typeof base & { versao: number | null }) => porta.gravarSgh(ctx, trilha('regra_visita_unidade'), (g) => g.definirRegra(r));
    const r1 = await gravar({ ...base, versao: null });
    expect(r1.versao).toBe(1);
    expect(await recusada(gravar({ ...base, versao: null }))).toBe('regra-mudou');
    const r2 = await gravar({ ...base, maxSimultaneos: 4, versao: 1 });
    expect(r2).toEqual({ id: r1.id, versao: 2 });
    expect(await recusada(gravar({ ...base, versao: 1 }))).toBe('regra-mudou');
    expect(await recusada(gravar({ ...base, idadeMinima: 16, versao: 2 }))).toBe('modelo-pendente');
    const lida = (await porta.regras(ctx)).find((r) => r.id === r1.id);
    expect(lida).toMatchObject({ unidade: `${P}-UI`, horaInicio: '10:00', horaFim: '21:00', maxSimultaneos: 4, versao: 2 });
    expect((await porta.regras(outro)).some((r) => r.id === r1.id)).toBe(false);
  });

  it('bloqueio por pedido barra a visita; a revogação leva o motivo à trilha e vale uma vez', async () => {
    const { id: pessoa } = await visitante('L0212-RG3');
    const bloquear = (b: Partial<NovoBloqueioVisita>) =>
      porta.gravarSgh(ctx, trilha('bloqueio_visitante'), (g) =>
        g.bloquear({
          internacao: ids.internacao,
          paciente: ids.paciente,
          motivo: 'pedido',
          abrangencia: 'todos',
          visitante: null,
          limite: null,
          incluiAcompanhante: false,
          justificativa: 'Pedido SINTETICO do paciente',
          documento: null,
          inicio: agoraLocal(),
          fim: null,
          usuario: 'x',
          ...b,
        }),
      );
    expect(await recusada(bloquear({ abrangencia: 'limite', limite: 1 }))).toBe('modelo-pendente');
    const id = await bloquear({});
    const lidos = await porta.bloqueios(ctx, ids.internacao);
    expect(lidos.find((b) => b.id === id)).toMatchObject({ motivo: 'pedido', abrangencia: 'todos', revogado: false, internacao: ids.internacao });
    expect(await recusada(visitaAoPaciente(pessoa, 'L0212CRACHA03'))).toBe('bloqueio');
    const revogar = () =>
      porta.gravarSgh(ctx, trilha('bloqueio_visitante'), (g) =>
        g.revogarBloqueio({ id, motivo: 'Paciente SINTETICO liberou as visitas', usuario: 'x', podeClinico: false }),
      );
    expect(await revogar()).toEqual({ id, internacao: ids.internacao, motivo: 'pedido' });
    const t = await ler<{ motivo: string }>(
      "SELECT motivo FROM trilha_auditoria WHERE entidade = 'bloqueio_visitante' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
      [id],
    );
    expect(t?.motivo).toBe('Paciente SINTETICO liberou as visitas');
    expect(await recusada(revogar())).toBe('ja-revogado');
    expect((await porta.bloqueios(ctx, ids.internacao)).some((b) => b.id === id)).toBe(false);
  });

  it('acompanhante: um vigente por internação, a troca encerra o anterior; o fim vale uma vez', async () => {
    const { id: a1 } = await visitante('L0212-RG4');
    const { id: a2 } = await visitante('L0212-RG5');
    const registrar = (v: number) =>
      porta.gravarSgh(ctx, trilha('acompanhante_internacao'), (g) =>
        g.registrarAcompanhante({
          internacao: ids.internacao,
          paciente: ids.paciente,
          bloco: `${P}-UI`,
          visitante: v,
          fundamento: 'idoso',
          refeicao: true,
          pernoite: true,
          observacao: null,
          inicio: agoraLocal(),
          usuario: 'x',
        }),
      );
    const r1 = await registrar(a1);
    expect(r1.substituido).toBeNull();
    expect(await recusada(registrar(a1))).toBe('ja-acompanhante');
    const r2 = await registrar(a2);
    expect(r2.substituido).toBe(r1.id);
    const vigentes = await porta.acompanhantes(ctx, `${P}-UI`);
    expect(vigentes.map((x) => [x.id, x.visitante, x.fundamento, x.refeicao])).toEqual([[r2.id, a2, 'idoso', true]]);
    const fim = () =>
      porta.gravarSgh(ctx, trilha('acompanhante_internacao'), (g) =>
        g.encerrarAcompanhante({ id: r2.id, motivo: 'Alta SINTETICA', fim: agoraLocal(), usuario: 'x' }),
      );
    expect(await fim()).toEqual({ id: r2.id, internacao: ids.internacao });
    expect(await recusada(fim())).toBe('ja-encerrado');
    expect(await porta.acompanhantes(ctx, `${P}-UI`)).toEqual([]);
  });

  it('terminal pela versão, no ponto de acesso do estabelecimento; a catraca aguarda o modelo', async () => {
    const t = (id: number | null, versao: number | null, nome = 'CATRACA L0212') =>
      porta.gravarSgh(ctx, trilha('terminal_acesso'), (g) =>
        g.configurarTerminal({ id, versao, nome, tipoTerminal: ids.modelo, fabricante: 0, local: 'PORTARIA L0212', sentido: 'ambos', ativo: true, usuario: 'x' }),
      );
    const r1 = await t(null, null);
    expect(r1.versao).toBe(1);
    expect(await recusada(t(null, null))).toBe('terminal-duplicado');
    expect(await t(r1.id, 1, 'CATRACA L0212 B')).toEqual({ id: r1.id, versao: 2 });
    expect(await recusada(t(r1.id, 1))).toBe('terminal-mudou');
    const lidos = await porta.terminais(ctx);
    expect(lidos.find((x) => x.id === r1.id)).toMatchObject({ nome: 'CATRACA L0212 B', local: 'PORTARIA L0212', tipoTerminal: ids.modelo, versao: 2 });
    expect((await porta.terminais(outro)).some((x) => x.id === r1.id)).toBe(false);
    expect(
      await recusada(
        porta.gravarSgh(ctx, trilha('evento_acesso_portaria'), (g) =>
          g.registrarEventoCatraca(
            { terminal: r1.id, cracha: 'L0212CRACHA01', sentido: 'entrada', ocorridoEm: agoraLocal(), chave: 'ev-0212', usuario: 'x' },
            () => ({ resultado: 'liberado', motivo: null, encerra: false }),
          ),
        ),
      ),
    ).toBe('modelo-pendente');
  });
});
