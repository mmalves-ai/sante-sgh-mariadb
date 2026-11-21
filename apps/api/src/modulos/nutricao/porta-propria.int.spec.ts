// Integração da porta própria da nutrição contra o MariaDB real (cliente f22_o3, da onda 3). Massa SINTÉTICA com o
// prefixo "L0304" (nenhuma pessoa real). Contrato de efeito de cada gravação (linhas, versão e trilha) e as recusas
// (outro estabelecimento, sem usuário, mapa repetido, modelo pendente); o reenvio do mesmo pedido não grava de novo.
// No fim, a massa de negócio é apagada; ficam o estabelecimento, o usuário e os domínios de teste, que a trilha (só
// inclusão) referencia. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { civil } from '../exames/relogio.js';
import { PortaNutricaoPropria } from './porta-propria.js';
import type { LinhaRetrato, TriagemParaGravar } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0304';
const RAIZ = resolve(import.meta.dirname, '../../../../..');

function garantirCliente(): void {
  const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], { cwd: RAIZ, encoding: 'utf8' });
  if (!lista.split('\n').some((l) => l.split('\t')[1] === CLIENTE))
    execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 3'], { cwd: RAIZ, stdio: 'ignore' });
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  if (l) return Number(l.id);
  try {
    return await e.inserir(ins, pi);
  } catch (x) {
    const de = await e.uma<{ id: number }>(sel, p);
    if (de) return Number(de.id);
    throw x;
  }
}

async function recusada(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
}

describe.skipIf(SEM_BANCO)('porta própria da nutrição (MariaDB, cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaNutricaoPropria;
  const ids = { est: 0, outroEst: 0, usuario: 0, profissional: 0, internacao: 0, atendimento: 0, paciente: 0, ui: 0, refeicao: 0, dieta: 0, jantar: 0, ceia: 0, jejum: 0 };
  let ctx: ContextoNucleo;
  let outro: ContextoNucleo;
  const trilha = (entidade: string): TrilhaDaGravacao => ({
    estabelecimento: ids.est,
    usuario: ids.usuario,
    acao: 'inclusao',
    entidade,
    entidadeId: null,
    dadosDepois: { teste: P },
    correlacao: 'teste-03-04',
  });
  const contar = (sql: string, p: unknown[]) =>
    nucleo.lerSomente(ctx, async (l) => Number((await l.uma<{ q: number }>(sql, p))?.q ?? 0));

  const limpar = (e: Escritor) =>
    (async () => {
      await e.executar(
        'DELETE it FROM mapa_dieta_item it JOIN mapa_dieta m ON m.id = it.mapa_dieta_id WHERE m.estabelecimento_id IN (?, ?)',
        [ids.est, ids.outroEst],
      );
      await e.executar('DELETE FROM mapa_dieta WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outroEst]);
      await e.executar(
        'DELETE r FROM triagem_nutricional_resposta r JOIN triagem_nutricional t ON t.id = r.triagem_nutricional_id WHERE t.estabelecimento_id IN (?, ?)',
        [ids.est, ids.outroEst],
      );
      await e.executar('DELETE FROM triagem_nutricional WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outroEst]);
      await e.executar('DELETE FROM correcao_registro_nutricao WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outroEst]);
      // O acompanhamento que substitui outro sai antes do substituído (chave do próprio registro).
      for (const [t, f] of [['avaliacao_nutricao_parenteral', ''], ['acompanhamento_terapia_nutricional', ' AND x.substitui_id IS NOT NULL'], ['acompanhamento_terapia_nutricional', '']])
        await e.executar(
          `DELETE x FROM ${t} x JOIN terapia_nutricional t ON t.id = x.terapia_nutricional_id WHERE t.estabelecimento_id IN (?, ?)${f}`,
          [ids.est, ids.outroEst],
        );
      await e.executar('DELETE FROM terapia_nutricional WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outroEst]);
      await e.executar('DELETE FROM registro_social WHERE estabelecimento_id IN (?, ?) AND adendo_registro_social_id IS NOT NULL', [ids.est, ids.outroEst]);
      await e.executar('DELETE FROM registro_social WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outroEst]);
      await e.executar(
        'DELETE b FROM barreira_alta b JOIN internacao i ON i.id = b.internacao_id WHERE i.estabelecimento_id IN (?, ?)',
        [ids.est, ids.outroEst],
      );
      await e.executar(
        'DELETE r FROM plano_refeicao_acompanhante_refeicao r JOIN plano_refeicao_acompanhante p ON p.id = r.plano_refeicao_acompanhante_id WHERE p.estabelecimento_id IN (?, ?)',
        [ids.est, ids.outroEst],
      );
      await e.executar('DELETE FROM plano_refeicao_acompanhante WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.outroEst]);
    })();

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-03-04' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(e, 'SELECT id FROM estabelecimento WHERE codigo = ?', [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora]);
      ids.est = await est(P);
      ids.outroEst = await est(`${P}B`);
      ids.usuario = await garantir(e, 'SELECT id FROM usuario WHERE login = ?', ['l0304.nutri'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['l0304.nutri', 'USUARIO SINTETICO L0304', agora]);
      await limpar(e);
      await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
      const g = (tabela: string, codigo: string, extra: Record<string, unknown> = {}) => {
        const cols = ['codigo', 'descricao', ...Object.keys(extra), 'criado_em'];
        return garantir(e, `SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo],
          `INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          [codigo, `${codigo} SINTETICO`, ...Object.values(extra), agora]);
      };
      await garantir(e, 'SELECT id FROM instrumento_triagem_nutricional WHERE codigo = ?', ['nrs2002'],
        "INSERT INTO instrumento_triagem_nutricional (codigo, nome, perguntas, pontos_corte, criado_em) VALUES ('nrs2002', 'NRS-2002', '[]', '{}', ?)",
        [agora]);
      ids.refeicao = await g('refeicao_do_dia', `${P}-ALM`, { ordem: 3, horario_inicio: '11:45:00' });
      ids.dieta = await g('modalidade_dieta', `${P}-BRA`);
      ids.jantar = await g('refeicao_do_dia', `${P}-JAN`, { ordem: 3041, horario_inicio: '18:00:00' });
      ids.ceia = await g('refeicao_do_dia', `${P}-CEI`, { ordem: 3042, horario_inicio: '21:00:00' });
      ids.jejum = await g('modalidade_dieta', `${P}-JEJ`, { classe: 'jejum', gera_bandeja: false, ordem: 0 });
      await garantir(e, "SELECT id FROM tipo_barreira_alta WHERE categoria = 'social' AND ativo = TRUE ORDER BY id LIMIT 1", [],
        "INSERT INTO tipo_barreira_alta (codigo, descricao, categoria, criado_em) VALUES (?, 'BARREIRA SOCIAL SINTETICA', 'social', ?)",
        [`${P}-SOC`, agora]);
      const setor = await garantir(e, 'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?', [ids.est, `${P}-SET`],
        "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, sigla, tipo, criado_em) VALUES (?, ?, 'POSTO L0304', 'PL0304', 'assistencial', ?)",
        [ids.est, `${P}-SET`, agora]);
      const ua = await garantir(e, 'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?', [ids.est, `${P}-UA`],
        "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, ?, 'INTERNACAO L0304', 'internacao', ?)",
        [ids.est, `${P}-UA`, agora]);
      ids.ui = await garantir(e, 'SELECT id FROM unidade_internacao WHERE estabelecimento_id = ? AND codigo = ?', [ids.est, `${P}-UI`],
        "INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em) VALUES (?, ?, ?, 'ENFERMARIA L0304', 'enfermaria', ?)",
        [ids.est, ua, `${P}-UI`, agora]);
      await e.executar('UPDATE unidade_internacao SET setor_funcional_id = ? WHERE id = ?', [setor, ids.ui]);
      const bloco = await garantir(e, 'SELECT id FROM bloco_internacao WHERE estabelecimento_id = ? AND codigo = ?', [ids.est, 'B1'],
        'INSERT INTO bloco_internacao (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)', [ids.est, 'B1', 'BLOCO L0304', agora]);
      const cat = await garantir(e, 'SELECT id FROM categoria_acomodacao WHERE codigo = ?', [`${P}-ENF`],
        "INSERT INTO categoria_acomodacao (codigo, descricao, tipo, criado_em) VALUES (?, 'ENFERMARIA L0304', 'enfermaria', ?)", [`${P}-ENF`, agora]);
      const acomodacao = await garantir(e, 'SELECT id FROM acomodacao WHERE estabelecimento_id = ? AND codigo = ?', [ids.est, 'ENF1'],
        `INSERT INTO acomodacao (estabelecimento_id, bloco_internacao_id, unidade_internacao_id, categoria_acomodacao_id, codigo, nome,
           quantidade_leitos, criado_em) VALUES (?, ?, ?, ?, 'ENF1', 'ENFERMARIA 1', 2, ?)`, [ids.est, bloco, ids.ui, cat, agora]);
      const sit = await garantir(e, "SELECT id FROM situacao_leito WHERE situacao_base = 'livre' ORDER BY id LIMIT 1", [],
        "INSERT INTO situacao_leito (codigo, descricao, situacao_base, criado_em) VALUES (?, 'LIVRE', 'livre', ?)", [`${P}-LIVRE`, agora]);
      const leito = await garantir(e, 'SELECT id FROM leito_hospitalar WHERE unidade_internacao_id = ? AND codigo = ?', [ids.ui, '01'],
        `INSERT INTO leito_hospitalar (estabelecimento_id, unidade_internacao_id, acomodacao_id, bloco_internacao_id, codigo,
           situacao_leito_id, ativo, criado_em) VALUES (?, ?, ?, ?, '01', ?, TRUE, ?)`, [ids.est, ids.ui, acomodacao, bloco, sit, agora]);
      const tiss = await garantir(e, 'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?', ['M2'],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('M2', 'CARATER L0304', 'teste', ?)", [agora]);
      const catAt = await garantir(e, 'SELECT id FROM categoria_atendimento WHERE codigo = ?', [`${P}-INT`],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'INTERNACAO L0304', 'internacao', ?)", [`${P}-INT`, agora]);
      const carater = await garantir(e, 'SELECT id FROM carater_admissao WHERE codigo = ?', [`${P}-ELE`],
        "INSERT INTO carater_admissao (codigo, descricao, urgencia, criado_em) VALUES (?, 'ELETIVA L0304', FALSE, ?)", [`${P}-ELE`, agora]);
      const modal = await garantir(e, 'SELECT id FROM modalidade_internacao WHERE codigo = ?', [`${P}-CLI`],
        "INSERT INTO modalidade_internacao (codigo, descricao, criado_em) VALUES (?, 'CLINICA L0304', ?)", [`${P}-CLI`, agora]);
      const esp = await garantir(e, 'SELECT id FROM especialidade_medica WHERE codigo = ?', [`${P}-CLM`],
        "INSERT INTO especialidade_medica (codigo, descricao, criado_em) VALUES (?, 'CLINICA MEDICA L0304', ?)", [`${P}-CLM`, agora]);
      const fonte = await garantir(e, 'SELECT id FROM fonte_pagadora WHERE codigo = ?', [`${P}-INT`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA L0304', 'operadora', 'ativa', ?)", [`${P}-INT`, agora]);
      const pessoa = (nome: string, nasc: string | null) =>
        garantir(e, 'SELECT id FROM pessoa_fisica WHERE nome = ?', [nome], 'INSERT INTO pessoa_fisica (nome, data_nascimento, criado_em) VALUES (?, ?, ?)', [nome, nasc, agora]);
      const pp = await pessoa(`PACIENTE SINTETICO ${P}`, '1950-03-10');
      const pm = await pessoa(`NUTRICIONISTA SINTETICA ${P}`, null);
      ids.paciente = await garantir(e, 'SELECT id FROM paciente WHERE pessoa_fisica_id = ?', [pp],
        "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)", [pp, 910_304_001, agora]);
      ids.profissional = await garantir(e, 'SELECT id FROM profissional WHERE pessoa_fisica_id = ?', [pm],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)", [pm, agora]);
      const cbo = await garantir(e, 'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?', ['223710'],
        "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, criado_em) VALUES ('223710', 'NUTRICIONISTA', TRUE, ?)", [agora]);
      await garantir(e, 'SELECT id FROM profissional_ocupacao WHERE profissional_id = ? AND ocupacao_cbo_id = ?', [ids.profissional, cbo],
        'INSERT INTO profissional_ocupacao (profissional_id, ocupacao_cbo_id, principal, criado_em) VALUES (?, ?, TRUE, ?)', [ids.profissional, cbo, agora]);
      await garantir(e, 'SELECT id FROM usuario_profissional WHERE usuario_id = ? AND profissional_id = ?', [ids.usuario, ids.profissional],
        'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)', [ids.usuario, ids.profissional, '2026-01-01', agora]);
      const entrada = new Date(Date.now() - 30 * 3_600_000);
      ids.atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
           fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids.est, `${P}-AT1`, ids.paciente, catAt, tiss, fonte, ids.profissional, entrada, agora]);
      ids.internacao = await e.inserir(
        `INSERT INTO internacao (estabelecimento_id, numero, atendimento_id, paciente_id, data_hora_entrada, carater_admissao_id,
           modalidade_internacao_id, unidade_internacao_id, leito_hospitalar_id, acomodacao_id, especialidade_medica_id,
           medico_assistente_profissional_id, fonte_pagadora_id, situacao, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?)`,
        [ids.est, `${P}-IN1`, ids.atendimento, ids.paciente, entrada, carater, modal, ids.ui, leito, acomodacao, esp, ids.profissional, fonte, agora]);
    });
    ctx = { cliente: CLIENTE, estabelecimento: ids.est, usuario: ids.usuario, correlacao: 'teste-03-04' };
    outro = { ...ctx, estabelecimento: ids.outroEst };
    porta = new PortaNutricaoPropria(nucleo);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-03-04' }, async (e) => {
      await limpar(e);
      await e.executar('DELETE FROM internacao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM atendimento WHERE estabelecimento_id = ?', [ids.est]);
    });
    await nucleo.encerrar();
  });

  const triagem = (reg: number): TriagemParaGravar => ({
    reg,
    pront: ids.paciente,
    paciente: ids.paciente,
    instrumento: 'nrs2002',
    versao: 'nrs2002-v1',
    respostas: JSON.stringify({ imc_abaixo_20_5: true, perda_peso: false, ingestao_reduzida: 2, observacao: 'sem queixa' }),
    estado: 1,
    gravidade: 1,
    idade: 1,
    total: 3,
    risco: 'risco',
    conduta: 'Acompanhar',
    pesoKg: 60,
    alturaCm: 170,
    imc: 20.76,
    admissao: '2026-11-20T08:00',
    horasDesdeAdmissao: 30,
    dentroDoPrazo: true,
    reavaliarEm: null,
    vinculo: ids.profissional,
    usuario: 'l0304.nutri',
  });

  it('leituras do estabelecimento: relógio, unidades, refeições, internados, vínculos; o outro estabelecimento não vê', async () => {
    const r = await porta.relogio(ctx);
    expect(r.agora).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect((await porta.unidades(ctx)).find((u) => u.unidade === `${P}-UI`)?.internados).toBe(1);
    expect((await porta.refeicoes(ctx)).some((x) => x.codigo === ids.refeicao && x.horario === '11:45')).toBe(true);
    const i = await porta.internados(ctx, `${P}-UI`);
    expect(i.cortada).toBe(false);
    expect(i.itens.map((x) => [x.reg, x.paciente, x.bloco, x.leito])).toEqual([[ids.internacao, ids.paciente, `${P}-UI`, 'ENF1-01']]);
    expect((await porta.internacao(ctx, ids.internacao))?.aberta).toBe(true);
    expect(await porta.internacao(outro, ids.internacao)).toBeNull();
    expect((await porta.internados(outro, null)).itens).toEqual([]);
    expect(await porta.vinculos(ctx, 'l0304.nutri')).toEqual([{ vinculo: ids.profissional, cbo: '223710', ativo: true }]);
    expect(await porta.cadastrosDoLogin(ctx, 'l0304.nutri')).toBe(1);
  });

  it('triagem: grava a linha com as parcelas, as respostas e a trilha; relê; o reenvio do pedido não grava de novo', async () => {
    // O pedido como o controlador o põe na sessão (comPedido): a mesma Idempotency-Key em dois pedidos.
    const chave = `${P}-tri-${Date.now()}`;
    const pedido = () => ({ ...ctx, pedido: { chave, ordem: 0 } }) as ContextoNucleo;
    const c = pedido();
    const id = await porta.gravarSgh(c, trilha('triagem_nutricional'), (g) => g.triar(triagem(ids.internacao)));
    expect(id).toBeGreaterThan(0);
    const linha = await nucleo.lerSomente(ctx, (l) =>
      l.uma('SELECT pontuacao_total, risco, situacao, dentro_prazo, versao, responsavel_usuario_id FROM triagem_nutricional WHERE id = ?', [id]));
    expect(linha).toMatchObject({ pontuacao_total: 3, risco: 'risco', situacao: 'ativo', versao: 1 });
    expect(Number(linha?.['dentro_prazo'])).toBe(1);
    expect(Number(linha?.['responsavel_usuario_id'])).toBe(ids.usuario);
    expect(await contar('SELECT COUNT(*) AS q FROM triagem_nutricional_resposta WHERE triagem_nutricional_id = ?', [id])).toBe(4);
    expect(await contar("SELECT COUNT(*) AS q FROM trilha_auditoria WHERE entidade = 'triagem_nutricional' AND estabelecimento_id = ?", [ids.est])).toBeGreaterThan(0);
    const de = await porta.gravarSgh(pedido(), trilha('triagem_nutricional'), (g) => g.triar(triagem(ids.internacao)));
    expect(de).toBe(id);
    expect(await contar('SELECT COUNT(*) AS q FROM triagem_nutricional WHERE internacao_id = ?', [ids.internacao])).toBe(1);
    // A segunda gravação do mesmo pedido não é confundida com a primeira (a ordem conta por pedido).
    const c2 = pedido();
    await porta.gravarSgh(c2, trilha('triagem_nutricional'), (g) => g.triar(triagem(ids.internacao)));
    const fora = await porta.gravarSgh(c2, trilha('triagem_nutricional'), (g) => g.triar({ ...triagem(ids.internacao), dentroDoPrazo: false }));
    expect(fora).not.toBe(id);
    expect(await contar('SELECT dentro_prazo AS q FROM triagem_nutricional WHERE id = ?', [fora])).toBe(0);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-tri-03-04' }, async (e) => {
      await e.executar('DELETE FROM triagem_nutricional_resposta WHERE triagem_nutricional_id = ?', [fora]);
      await e.executar('DELETE FROM triagem_nutricional WHERE id = ?', [fora]);
    });
    const lidas = await porta.triagens(ctx, [ids.internacao]);
    expect(lidas[0]).toMatchObject({ id, instrumento: 'nrs2002', total: 3, por: 'l0304.nutri', inativa: false });
    expect(await porta.triagens(outro, [ids.internacao])).toEqual([]);
    expect((await porta.fichas(ctx, ids.paciente)).quantidade).toBe(1);
    expect(await porta.internacaoDoRegistro(ctx, 'triagem', id)).toBe(ids.internacao);
  });

  it('meta da terapia: grava as grandezas de base e deriva as razões na leitura', async () => {
    const id = await porta.gravarSgh(ctx, trilha('terapia_nutricional'), (g) =>
      g.registrarMeta({
        reg: ids.internacao, pront: ids.paciente, paciente: ids.paciente, via: 'enteral', vinculo: ids.profissional, usuario: 'l0304.nutri',
        itemDieta: null, dieta: null, pesoKg: 60, kcalPorKg: 25, proteinaGPorKg: 1.5, metaKcal: 1500, metaProteinaG: 90,
        densidadeKcalMl: 1.5, proteinaGL: 90, metaVolumeMl: 1000, observacao: null,
      }));
    const m = await porta.meta(ctx, id);
    expect(m).toMatchObject({ reg: ids.internacao, via: 'enteral', kcalPorKg: 25, proteinaGPorKg: 1.5, densidadeKcalMl: 1.5, proteinaGL: 90, origemTerapia: 'informada' });
    expect([...(await porta.comMeta(ctx, [ids.internacao]))]).toEqual([ids.internacao]);
    expect((await porta.terapia(ctx, ids.internacao)).metas.map((x) => x.id)).toEqual([id]);
    expect(await porta.meta(outro, id)).toBeNull();
    const linha = await nucleo.lerSomente(ctx, (l) => l.uma('SELECT tipo_terapia, via_acesso, situacao, versao FROM terapia_nutricional WHERE id = ?', [id]));
    expect(linha).toMatchObject({ tipo_terapia: 'enteral', via_acesso: 'sonda_nasoenteral', situacao: 'liberada', versao: 1 });
  });

  it('mapa de dietas: fecha com as linhas, relê o retrato e recusa o segundo fechamento do mesmo dia e refeição', async () => {
    const hoje = civil(new Date()).data;
    const linha = {
      reg: ids.internacao, pront: ids.paciente, acomodacao: 'ENF1', leito: 'ENF1-01', itemDieta: null, item: null, dieta: ids.dieta,
      tipo: 'oral' as const, nomeDieta: 'BRANDA', caracteristicas: 'Hipossódica', jejumOrigem: null, alergias: 'Leite', acompanhante: true, prescritoEm: null,
    };
    const fechar = () =>
      porta.gravarSgh(ctx, trilha('mapa_dieta'), (g) =>
        g.fecharMapa({ unidade: `${P}-UI`, refeicao: ids.refeicao, data: hoje, corteEm: `${hoje}T09:45`, hash: 'h1', linhas: [linha], usuario: 'l0304.nutri' }));
    const id = await fechar();
    const r = await porta.retrato(ctx, `${P}-UI`, ids.refeicao, hoje);
    expect(r).toMatchObject({ id, itens: 1, jejuns: 0, corteEm: `${hoje}T09:45`, por: 'l0304.nutri' });
    expect(r?.linhas[0]).toMatchObject({ reg: ids.internacao, leito: 'ENF1-01', caracteristicas: 'Hipossódica' });
    expect(await contar('SELECT quantidade_acompanhantes AS q FROM mapa_dieta_item WHERE mapa_dieta_id = ?', [id])).toBe(1);
    expect(await recusada(fechar())).not.toBeNull();
    expect(await contar('SELECT COUNT(*) AS q FROM mapa_dieta WHERE estabelecimento_id = ?', [ids.est])).toBe(1);
    expect(await porta.retrato(outro, `${P}-UI`, ids.refeicao, hoje)).toBeNull();
  });

  it('mapa de dietas: o paciente em jejum (sem dieta) entra com a modalidade de jejum; sem prescrição não gera bandeja', async () => {
    const hoje = civil(new Date()).data;
    const linhaJejum = {
      reg: ids.internacao, pront: ids.paciente, acomodacao: 'ENF1', leito: 'ENF1-01', itemDieta: null, item: null, dieta: null,
      tipo: 'jejum' as const, nomeDieta: null, caracteristicas: null, jejumOrigem: 'exame' as const, alergias: null, acompanhante: false, prescritoEm: null,
    };
    const id = await porta.gravarSgh(ctx, trilha('mapa_dieta'), (g) =>
      g.fecharMapa({ unidade: `${P}-UI`, refeicao: ids.jantar, data: hoje, corteEm: `${hoje}T15:00`, hash: 'h2', linhas: [linhaJejum], usuario: 'l0304.nutri' }));
    expect(await porta.retrato(ctx, `${P}-UI`, ids.jantar, hoje)).toMatchObject({ id, itens: 1, jejuns: 1 });
    const it = await nucleo.lerSomente(ctx, (l) => l.uma('SELECT modalidade_dieta_id, jejum, jejum_motivo FROM mapa_dieta_item WHERE mapa_dieta_id = ?', [id]));
    expect([Number(it?.['modalidade_dieta_id']), Number(it?.['jejum']), it?.['jejum_motivo']]).toEqual([ids.jejum, 1, 'exame']);
    const semPrescricao = { ...linhaJejum, tipo: 'sem-prescricao' as const, jejumOrigem: null } as LinhaRetrato;
    const id2 = await porta.gravarSgh(ctx, trilha('mapa_dieta'), (g) =>
      g.fecharMapa({ unidade: `${P}-UI`, refeicao: ids.ceia, data: hoje, corteEm: `${hoje}T20:00`, hash: 'h3', linhas: [semPrescricao], usuario: 'l0304.nutri' }));
    expect(await porta.retrato(ctx, `${P}-UI`, ids.ceia, hoje)).toMatchObject({ id: id2, itens: 0, jejuns: 0 });
    expect(await recusada(porta.gravarSgh(ctx, trilha('mapa_dieta'), (g) =>
      g.fecharMapa({ unidade: `${P}-UI`, refeicao: ids.refeicao, data: '2026-01-02', corteEm: '2026-01-02T09:45', hash: 'h4',
        linhas: [{ ...linhaJejum, tipo: 'oral' as const, jejumOrigem: null }], usuario: 'l0304.nutri' })))).toBe('dieta-sem-modalidade');
  });

  it('acompanhamento do dia, retificação, avaliação da NPT e correção: um ativo por dia, o anterior fica inativo', async () => {
    const base = { reg: ids.internacao, pront: ids.paciente, paciente: ids.paciente, vinculo: ids.profissional, usuario: 'l0304.nutri' };
    const meta = await porta.gravarSgh(ctx, trilha('terapia_nutricional'), (g) =>
      g.registrarMeta({ ...base, via: 'parenteral', itemDieta: null, dieta: null, pesoKg: 60, kcalPorKg: 25, proteinaGPorKg: 1.5,
        metaKcal: 1500, metaProteinaG: 90, densidadeKcalMl: 1, proteinaGL: 60, metaVolumeMl: 1500, observacao: null }));
    const dia = (x: Partial<{ volumeInfundidoMl: number; pctKcal: number }> = {}) => ({
      ...base, via: 'parenteral' as const, meta, data: '2026-11-20', volumePrescritoMl: 1500, volumeInfundidoMl: 1200,
      origemVolume: 'informado' as const, kcalAtingida: 1200, proteinaAtingidaG: 72, pctKcal: 80, pctProteina: 80,
      motivo: null, observacao: null, ...x,
    });
    const a1 = await porta.gravarSgh(ctx, trilha('terapia_nutricional'), (g) => g.registrarAcompanhamento(dia()));
    // O segundo do mesmo dia sem a correção é recusado inteiro (nada gravado).
    expect(await recusada(porta.gravarSgh(ctx, trilha('terapia_nutricional'), (g) => g.registrarAcompanhamento(dia())))).toBe('acompanhamento-do-dia');
    const a2 = await porta.gravarSgh(ctx, trilha('correcao_registro_nutricao'), async (g) => {
      const x = await g.registrarAcompanhamento(dia({ volumeInfundidoMl: 1500, pctKcal: 100 }));
      await g.corrigir({ ...base, registro: 'acompanhamento', id: a1, acao: 'retificacao', idNovo: x, motivo: 'volume corrigido' });
      return x;
    });
    const t = await porta.terapia(ctx, ids.internacao);
    expect(t.acompanhamentos.map((a) => [a.id, a.pctKcal])).toEqual([[a2, 100], [a1, 80]]);
    const k = await porta.correcoes(ctx, 'acompanhamento', [a1, a2]);
    expect(k.inativa.get(a1)).toMatchObject({ acao: 'retificacao', idNovo: a2, por: 'l0304.nutri' });
    expect(k.substitui.get(a2)).toBe(a1);
    expect(await porta.internacaoDoRegistro(ctx, 'acompanhamento', a2)).toBe(ids.internacao);
    expect(await recusada(porta.gravarSgh(ctx, trilha('correcao_registro_nutricao'), (g) =>
      g.corrigir({ ...base, registro: 'acompanhamento', id: a1, acao: 'estorno', idNovo: null, motivo: 'de novo' })))).toBe('registro-ja-corrigido');
    const linhas = await nucleo.lerSomente(ctx, (l) => l.consultar(
      'SELECT id, situacao, substitui_id FROM acompanhamento_terapia_nutricional WHERE terapia_nutricional_id = ? ORDER BY id', [meta]));
    expect(linhas.map((r) => [r['situacao'], r['substitui_id'] === null ? null : Number(r['substitui_id'])])).toEqual([['retificado', null], ['ativo', a1]]);
    const npt = { ...base, meta, parecer: 'adequada' as never, acesso: 'central' as never, osmolaridade: 1200, estabilidade: true, compatibilidade: true, observacao: null };
    const av = await porta.gravarSgh(ctx, trilha('avaliacao_nutricao_parenteral'), (g) => g.avaliarNpt(npt));
    expect(await porta.avaliacoesNpt(ctx, ids.internacao)).toMatchObject([{ id: av, meta, osmolaridade: 1200, estabilidade: true }]);
    expect(await recusada(porta.gravarSgh(ctx, trilha('avaliacao_nutricao_parenteral'), (g) => g.avaliarNpt(npt)))).toBe('avaliacao-registrada');
    expect(await porta.avaliacoesNpt(outro, ids.internacao)).toEqual([]);
  });

  it('serviço social: registro com a barreira social, adendo, último registro e estorno', async () => {
    const base = { reg: ids.internacao, pront: ids.paciente, vinculo: ids.profissional, usuario: 'l0304.nutri' };
    const social = {
      ...base, paciente: ids.paciente, tipo: 'avaliacao' as const, redeApoio: 'fragil' as never, vulnerabilidades: ['sem-renda', 'sem-renda'] as never[],
      risco: 'alto' as never, encaminhamentos: ['cras-creas'] as never[], parecer: 'Parecer sintético.', orientacoes: null,
      barreira: { descricao: 'Sem cuidador em casa', responsavel: 'Assistente social', prazo: '2026-11-25' },
    };
    const r = await porta.gravarSgh(ctx, trilha('registro_social'), (g) => g.registrarSocial(social));
    expect(r.barreira).not.toBeNull();
    const ad = await porta.gravarSgh(ctx, trilha('registro_social'), (g) =>
      g.adendoSocial({ ...base, de: r.id, texto: 'Complemento sintético.', motivo: 'faltou o contato' }));
    const lidos = await porta.sociais(ctx, ids.internacao);
    expect(lidos.map((x) => [x.id, x.tipo, x.adendoDe])).toEqual([[ad, 'adendo', r.id], [r.id, 'avaliacao', null]]);
    expect(lidos[1]).toMatchObject({ vulnerabilidades: ['sem-renda'], encaminhamentos: ['cras-creas'], barreira: r.barreira, por: 'l0304.nutri' });
    expect((await porta.ultimosSociais(ctx, [ids.internacao])).get(ids.internacao)).toMatchObject({ risco: 'alto', tipo: 'avaliacao' });
    expect((await porta.barreirasSociais(ctx, [ids.internacao])).get(ids.internacao)).toBe(1);
    await porta.gravarSgh(ctx, trilha('correcao_registro_nutricao'), (g) =>
      g.corrigir({ ...base, registro: 'social', id: r.id, acao: 'estorno', idNovo: null, motivo: 'paciente errado' }));
    expect((await porta.ultimosSociais(ctx, [ids.internacao])).size).toBe(0);
    expect(await recusada(porta.gravarSgh(ctx, trilha('registro_social'), (g) =>
      g.adendoSocial({ ...base, de: r.id, texto: 'x', motivo: 'y' })))).toBe('registro-ja-corrigido');
    expect(await porta.sociais(outro, ids.internacao)).toEqual([]);
  });

  it('refeição do acompanhante: uma vigente, alteração devolve o anterior, encerramento', async () => {
    const a = { reg: ids.internacao, pront: ids.paciente, baseLegal: 'idoso' as never, refeicoes: [ids.jantar, ids.refeicao, ids.refeicao],
      inicio: '2026-11-20', fim: null, observacao: null, usuario: 'l0304.nutri' };
    const id = await porta.gravarSgh(ctx, trilha('plano_refeicao_acompanhante'), (g) => g.registrarAcompanhante(a));
    expect(await recusada(porta.gravarSgh(ctx, trilha('plano_refeicao_acompanhante'), (g) => g.registrarAcompanhante(a)))).toBe('acompanhante-vigente');
    expect(await porta.acompanhante(ctx, id)).toMatchObject({ reg: ids.internacao, refeicoes: [ids.refeicao, ids.jantar].sort((x, y) => x - y), inicio: '2026-11-20', fim: null, situacao: 'ativa', por: 'l0304.nutri' });
    const antes = await porta.gravarSgh(ctx, trilha('plano_refeicao_acompanhante'), (g) =>
      g.alterarAcompanhante({ id, dieta: 'Branda', refeicoes: [ids.ceia], fim: '2026-11-22', observacao: 'ok' }));
    expect(antes).toEqual({ dieta: null, refeicoes: [ids.refeicao, ids.jantar].sort((x, y) => x - y), fim: null, observacao: null });
    expect(await porta.acompanhante(ctx, id)).toMatchObject({ dieta: 'Branda', refeicoes: [ids.ceia], fim: '2026-11-22', observacao: 'ok' });
    // A refeição que sai é exclusão lógica com carimbo; a que volta reativa a mesma linha (chave única plano + refeição).
    const linhasRef = () => nucleo.lerSomente(ctx, (l) => l.consultar(
      'SELECT refeicao_do_dia_id AS r, excluido_em, excluido_por FROM plano_refeicao_acompanhante_refeicao WHERE plano_refeicao_acompanhante_id = ? ORDER BY refeicao_do_dia_id', [id]));
    const saiu = (await linhasRef()).find((x) => Number(x['r']) === ids.jantar);
    expect(saiu?.['excluido_em']).not.toBeNull();
    expect(Number(saiu?.['excluido_por'])).toBe(ctx.usuario);
    await porta.gravarSgh(ctx, trilha('plano_refeicao_acompanhante'), (g) =>
      g.alterarAcompanhante({ id, dieta: 'Branda', refeicoes: [ids.ceia, ids.jantar], fim: '2026-11-22', observacao: 'ok' }));
    expect((await porta.acompanhante(ctx, id))?.refeicoes).toEqual([ids.ceia, ids.jantar].sort((x, y) => x - y));
    expect((await linhasRef()).filter((x) => Number(x['r']) === ids.jantar).map((x) => x['excluido_em'])).toEqual([null]);
    expect((await porta.acompanhantesVigentes(ctx, [ids.internacao])).get(ids.internacao)?.id).toBe(id);
    expect(await porta.gravarSgh(ctx, trilha('plano_refeicao_acompanhante'), (g) => g.encerrarAcompanhante({ id, motivo: 'alta', usuario: 'x' }))).toBe(1);
    expect((await porta.acompanhantes(ctx, ids.internacao)).map((x) => x.situacao)).toEqual(['encerrada']);
    expect(await recusada(porta.gravarSgh(ctx, trilha('plano_refeicao_acompanhante'), (g) => g.encerrarAcompanhante({ id, motivo: 'alta', usuario: 'x' })))).toBe('acompanhante-desatualizado');
    expect(await porta.acompanhantes(outro, ids.internacao)).toEqual([]);
  });

  it('recusas: outro estabelecimento, sem usuário e modelo pendente (nada gravado)', async () => {
    expect(await recusada(porta.gravarSgh(outro, trilha('triagem_nutricional'), (g) => g.triar(triagem(ids.internacao))))).toBe('internacao-inexistente');
    expect(await recusada(porta.gravarSgh({ ...ctx, usuario: null }, trilha('triagem_nutricional'), (g) => g.triar(triagem(ids.internacao))))).toBe('sem-usuario');
    // O histórico de alteração do plano do acompanhante aguarda a tabela de eventos (pedido do lote).
    expect(await recusada(porta.gravarSgh(ctx, trilha('plano_refeicao_acompanhante'), (g) => g.registrarAlteracao({
      tabela: 'plano_refeicao_acompanhante', id: 1, evento: 'alterada', antes: null, depois: null, motivo: 'x', usuario: 'x',
    })))).toBe('modelo-pendente');
    expect(await contar('SELECT COUNT(*) AS q FROM triagem_nutricional WHERE estabelecimento_id = ?', [ids.outroEst])).toBe(0);
  });
});
