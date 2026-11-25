// Contrato de efeito da impressão da identificação do paciente (01-ADM L79) no MariaDB: a 1ª impressão da pulseira e
// da etiqueta grava a linha da identificação (via 1, estação reconhecida pelo endereço e impressora da estação); dali
// em diante só sai com o motivo do catálogo, e cada reimpressão sobe a via e grava o registro da reimpressão (motivo,
// complemento, estação, impressora). As leituras (catálogo, situação, histórico, motivos) devolvem o que as telas
// mostram. Massa sintética (prefixo L79P); nenhum dado real.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { ImpressaoIdentificacaoPropria } from './impressao-identificacao-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L79P';
const IP = '10.79.0.5';

async function codigo(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    if (e instanceof ErroOperacao) return String(e.problema.codigo ?? '');
    if (e instanceof ErroProblema) return String(e.extras?.['codigo'] ?? e.tipo);
    return `outro: ${(e as Error)?.message ?? ''}`;
  }
}

describe.skipIf(SEM_BANCO)('impressão da identificação do paciente no banco próprio (cliente f22_o2)', () => {
  const nucleo = new NucleoProprio();
  let porta: ImpressaoIdentificacaoPropria;
  const ids = {
    est: 0,
    outroEst: 0,
    usuario: 0,
    atendimento: 0,
    atendimentoFora: 0,
    estacaoIp: 0,
    estacaoSemVinculo: 0,
    estacaoFora: 0,
    impEstacao: 0,
    impGeral: 0,
    finPulseira: 0,
    finEtiqueta: 0,
    motivo: 0,
    motivoComplemento: 0,
    motivoInativo: 0,
  };
  const c = { hospital: P, login: `${P}.RECEPCAO`, enderecoIp: IP };
  const g = () => ({ ...c, correlacao: 'teste-l79p', chaveIdempotencia: `tl79p-${randomUUID()}` });
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l79p' }, (l) => l.uma(sql, p));
  const linha = (tipo: string) =>
    um('SELECT * FROM impressao_identificacao WHERE atendimento_id = ? AND tipo = ?', [
      ids.atendimento,
      tipo,
    ]);
  const registros = async () =>
    Number(
      (await um('SELECT COUNT(*) AS n FROM registro_reimpressao WHERE estabelecimento_id = ?', [ids.est]))?.[
        'n'
      ],
    );

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-l79p' }, async (e) => {
      await e.executar('DELETE FROM registro_reimpressao WHERE estabelecimento_id = ?', [ids.est]);
      await e.executar('DELETE FROM impressao_identificacao WHERE estabelecimento_id = ?', [ids.est]);
      await limparTrilhaDaMassa(e, { codigos: [P] });
    });
  }

  beforeAll(async () => {
    if ((await nucleo.cliente(CLIENTE)).banco !== `cliente_${CLIENTE}`)
      throw new Error('Cliente de teste inesperado.');
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-l79p' }, async (e) => {
      const agora = new Date();
      const ter = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
        const l = await e.uma<{ id: number }>(sel, p);
        return l ? Number(l.id) : e.inserir(ins, pi);
      };
      const estab = (cod: string) =>
        ter(
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, `ESTAB ${cod} SINTETICO`, `ESTAB ${cod} SINTETICO`, agora],
        );
      ids.est = await estab(P);
      ids.outroEst = await estab(`${P}B`);
      ids.usuario = await ter(
        'SELECT id FROM usuario WHERE login = ?',
        [c.login],
        "INSERT INTO usuario (login, nome, dispensa_cpf, tipo_conta, criado_em) VALUES (?, 'RECEPCAO SINTETICA', TRUE, 'pessoa', ?)",
        [c.login, agora],
      );
      // O atendimento sintético reaproveita só as referências (ids) de um atendimento que já existe no cliente.
      const atendimento = (est: number, numero: string) =>
        ter(
          'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
          [est, numero],
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           SELECT ?, ?, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id,
                  profissional_id, ?, ? FROM atendimento ORDER BY id LIMIT 1`,
          [est, numero, agora, agora],
        );
      ids.atendimento = await atendimento(ids.est, `${P}-1`);
      ids.atendimentoFora = await atendimento(ids.outroEst, `${P}-2`);
      const estacao = (est: number, cod: string, ip: string | null) =>
        ter(
          'SELECT id FROM estacao_trabalho WHERE estabelecimento_id = ? AND codigo = ?',
          [est, cod],
          "INSERT INTO estacao_trabalho (estabelecimento_id, codigo, nome, endereco_ip, criado_em) VALUES (?, ?, 'ESTACAO SINTETICA', ?, ?)",
          [est, cod, ip, agora],
        );
      ids.estacaoIp = await estacao(ids.est, `${P}E1`, IP);
      ids.estacaoSemVinculo = await estacao(ids.est, `${P}E2`, null);
      ids.estacaoFora = await estacao(ids.outroEst, `${P}E3`, null);
      const imp = (cod: string, nome: string) =>
        ter(
          'SELECT id FROM impressora WHERE estabelecimento_id = ? AND codigo = ?',
          [ids.est, cod],
          "INSERT INTO impressora (estabelecimento_id, codigo, nome, tipo, conexao, criado_em) VALUES (?, ?, ?, 'pulseira', 'local', ?)",
          [ids.est, cod, nome, agora],
        );
      ids.impEstacao = await imp(`${P}IE`, 'IMPRESSORA DA ESTACAO');
      ids.impGeral = await imp(`${P}IG`, 'IMPRESSORA GERAL');
      const fin = (cod: string, midia: string) =>
        ter(
          'SELECT id FROM finalidade_impressao WHERE codigo = ?',
          [cod],
          "INSERT INTO finalidade_impressao (codigo, descricao, tipo_midia, criado_em) VALUES (?, 'FINALIDADE SINTETICA', ?, ?)",
          [cod, midia, agora],
        );
      ids.finPulseira = await fin(`${P}_PULSEIRA`, 'pulseira');
      ids.finEtiqueta = await fin(`${P}_PACIENTE`, 'etiqueta');
      const motivo = (cod: string, exige: boolean, ativo: boolean) =>
        ter(
          'SELECT id FROM motivo_reimpressao WHERE codigo = ?',
          [cod],
          "INSERT INTO motivo_reimpressao (codigo, descricao, exige_complemento, ativo, criado_em) VALUES (?, 'MOTIVO SINTETICO', ?, ?, ?)",
          [cod, exige, ativo, agora],
        );
      ids.motivo = await motivo(`${P}M`, false, true);
      ids.motivoComplemento = await motivo(`${P}MC`, true, true);
      ids.motivoInativo = await motivo(`${P}MI`, false, false);
      for (const f of [ids.finPulseira, ids.finEtiqueta]) {
        // A estação reconhecida pelo endereço tem impressora própria; o estabelecimento tem a geral.
        await ter(
          'SELECT id FROM estacao_impressora WHERE estacao_trabalho_id = ? AND finalidade_impressao_id = ?',
          [ids.estacaoIp, f],
          'INSERT INTO estacao_impressora (estacao_trabalho_id, finalidade_impressao_id, impressora_id, padrao, criado_em) VALUES (?, ?, ?, TRUE, ?)',
          [ids.estacaoIp, f, ids.impEstacao, agora],
        );
        await ter(
          'SELECT id FROM impressora_finalidade_estabelecimento WHERE estabelecimento_id = ? AND finalidade_impressao_id = ?',
          [ids.est, f],
          'INSERT INTO impressora_finalidade_estabelecimento (estabelecimento_id, finalidade_impressao_id, impressora_id, copias, criado_em) VALUES (?, ?, ?, 1, ?)',
          [ids.est, f, ids.impGeral, agora],
        );
      }
    });
    porta = new ImpressaoIdentificacaoPropria(nucleo, CLIENTE);
    await limpar();
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('a 1ª impressão da pulseira grava a via 1 com a estação do endereço e a impressora da estação', async () => {
    expect(await porta.conferir(c, { atendimento: ids.atendimento, tipo: 'pulseira' })).toMatchObject({
      via: 1,
      reimpressao: false,
      estacao: ids.estacaoIp,
      impressora: { id: ids.impEstacao, nivel: 'estacao' },
    });
    expect(await linha('pulseira')).toBeNull();
    const r = await porta.registrar(g(), { atendimento: ids.atendimento, tipo: 'pulseira', quantidade: 2 });
    expect(r).toMatchObject({ via: 1, reimpressao: false, registro: null, repetida: false });
    const l = await linha('pulseira');
    expect(l).toMatchObject({
      estabelecimento_id: ids.est,
      vias: 1,
      finalidade_impressao_id: ids.finPulseira,
      estacao_trabalho_id: ids.estacaoIp,
      impressora_id: ids.impEstacao,
      criado_por: ids.usuario,
    });
    expect(Number(l?.['id'])).toBe(r.id);
    expect(await registros()).toBe(0);
    const trilha = await um('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [
      ids.est,
    ]);
    expect(Number(trilha?.['n'])).toBe(1);
  });

  it('já impressa, não sai sem motivo: nada muda no banco', async () => {
    const pedido = { atendimento: ids.atendimento, tipo: 'pulseira' as const };
    expect(await codigo(porta.conferir(c, pedido))).toBe('motivo-obrigatorio');
    expect(await codigo(porta.registrar(g(), pedido))).toBe('motivo-obrigatorio');
    expect(await codigo(porta.registrar(g(), { ...pedido, motivo: ids.motivoInativo }))).toBe(
      'motivo-inativo',
    );
    expect(await codigo(porta.registrar(g(), { ...pedido, motivo: 999_999_999 }))).toBe('motivo-inexistente');
    expect(await codigo(porta.registrar(g(), { ...pedido, motivo: ids.motivoComplemento }))).toBe(
      'complemento-obrigatorio',
    );
    expect(await linha('pulseira')).toMatchObject({ vias: 1 });
    expect(await registros()).toBe(0);
  });

  it('a reimpressão sobe a via e grava o registro com motivo, complemento, estação e impressora', async () => {
    const pedido = { atendimento: ids.atendimento, tipo: 'pulseira' as const };
    const chave = g();
    const r2 = await porta.registrar(chave, {
      ...pedido,
      motivo: ids.motivoComplemento,
      complemento: '  pulseira rasgada  ',
    });
    expect(r2).toMatchObject({ via: 2, reimpressao: true, repetida: false });
    // O mesmo pedido repetido (mesma chave) devolve o gravado e não tira outra via.
    const de_novo = await porta.registrar(chave, {
      ...pedido,
      motivo: ids.motivoComplemento,
      complemento: '  pulseira rasgada  ',
    });
    expect(de_novo).toMatchObject({ via: 2, repetida: true });
    expect(await registros()).toBe(1);
    const reg = await um('SELECT * FROM registro_reimpressao WHERE id = ?', [r2.registro]);
    expect(reg).toMatchObject({
      estabelecimento_id: ids.est,
      entidade: 'impressao_identificacao',
      entidade_id: r2.id,
      motivo_reimpressao_id: ids.motivoComplemento,
      motivo_texto: 'pulseira rasgada',
      via: 2,
      destino: 'impressora',
      estacao_trabalho_id: ids.estacaoIp,
      impressora_id: ids.impEstacao,
      usuario_id: ids.usuario,
    });
    const r3 = await porta.registrar(g(), { ...pedido, motivo: ids.motivo });
    expect(r3).toMatchObject({ via: 3, reimpressao: true });
    const l = await linha('pulseira');
    expect(l).toMatchObject({ vias: 3 });
    expect(new Date(String(l?.['ultima_impressao_em'])).getTime()).toBeGreaterThanOrEqual(
      new Date(String(l?.['primeira_impressao_em'])).getTime(),
    );
    expect(await registros()).toBe(2);
  });

  it('a etiqueta é outra identificação; estação sem vínculo cai no padrão do estabelecimento; recusas de escopo', async () => {
    const r = await porta.registrar(g(), {
      atendimento: ids.atendimento,
      tipo: 'etiqueta',
      estacao: ids.estacaoSemVinculo,
    });
    expect(r).toMatchObject({
      via: 1,
      reimpressao: false,
      estacao: ids.estacaoSemVinculo,
      impressora: { id: ids.impGeral, nivel: 'estabelecimento' },
    });
    expect(await linha('etiqueta')).toMatchObject({
      vias: 1,
      finalidade_impressao_id: ids.finEtiqueta,
      impressora_id: ids.impGeral,
    });
    expect(await linha('pulseira')).toMatchObject({ vias: 3 });
    expect(
      await codigo(
        porta.registrar(g(), {
          atendimento: ids.atendimento,
          tipo: 'etiqueta',
          motivo: ids.motivo,
          estacao: ids.estacaoFora,
        }),
      ),
    ).toBe('estacao-inexistente');
    expect(await codigo(porta.registrar(g(), { atendimento: ids.atendimentoFora, tipo: 'pulseira' }))).toBe(
      'atendimento-inexistente',
    );
    expect(await linha('etiqueta')).toMatchObject({ vias: 1 });
    expect(await registros()).toBe(2);
  });

  it('as leituras devolvem a situação, o histórico, os motivos ativos e o catálogo do estabelecimento', async () => {
    const s = await porta.situacao(c, { atendimento: ids.atendimento });
    expect(s.estacao).toBe(ids.estacaoIp);
    expect(s.identificacoes).toMatchObject([
      { tipo: 'pulseira', vias: 3, finalidade: ids.finPulseira, impressora: { id: ids.impEstacao } },
      { tipo: 'etiqueta', vias: 1, finalidade: ids.finEtiqueta, impressora: { id: ids.impEstacao } },
    ]);
    const h = await porta.historico(c, { atendimento: ids.atendimento });
    expect(h.map((x) => [x.tipo, x.via, x.complemento, x.usuario, x.impressora])).toEqual([
      ['pulseira', 3, null, c.login, 'IMPRESSORA DA ESTACAO'],
      ['pulseira', 2, 'pulseira rasgada', c.login, 'IMPRESSORA DA ESTACAO'],
    ]);
    const motivos = await porta.motivos(c);
    expect(motivos.some((m) => m.id === ids.motivoComplemento && m.exigeComplemento)).toBe(true);
    expect(motivos.some((m) => m.id === ids.motivoInativo)).toBe(false);
    const cat = await porta.catalogo(c);
    expect(cat.eu).toBe(ids.usuario);
    expect(cat.estacaoAtual).toBe(ids.estacaoIp);
    expect(cat.estacoes.map((e) => e.id).sort()).toEqual([ids.estacaoIp, ids.estacaoSemVinculo].sort());
    expect(cat.impressoras.map((i) => i.id).sort()).toEqual([ids.impEstacao, ids.impGeral].sort());
    expect(cat.vinculos).toHaveLength(2);
    expect(cat.padroes.map((p) => [p.impressora, p.unidade])).toEqual([
      [ids.impGeral, null],
      [ids.impGeral, null],
    ]);
    expect(cat.finalidades.some((f) => f.id === ids.finPulseira && f.midia === 'pulseira')).toBe(true);
    expect(await codigo(porta.situacao(c, { atendimento: ids.atendimentoFora }))).toBe(
      'atendimento-inexistente',
    );
  });

  it('a internação leva ao atendimento dela (leitura)', async () => {
    const i = await um(
      `SELECT i.id, i.atendimento_id, e.codigo FROM internacao i JOIN estabelecimento e ON e.id = i.estabelecimento_id
        WHERE i.excluido_em IS NULL ORDER BY i.id LIMIT 1`,
      [],
    );
    if (!i) return;
    const s = await porta.situacao(
      { hospital: String(i['codigo']), login: c.login },
      { internacao: Number(i['id']) },
    );
    expect(s.atendimento).toBe(Number(i['atendimento_id']));
    expect(s.identificacoes.map((x) => x.tipo)).toEqual(['pulseira', 'etiqueta']);
  });
});
