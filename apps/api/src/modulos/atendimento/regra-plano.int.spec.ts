// Contrato de efeito da regra própria do plano da fonte pagadora (02-CAD linha 24) contra o MariaDB real (cliente de
// teste; SGH_CLIENTE_TESTE, f22_o1 por padrão). Prova o que fica no banco:
//   - a inclusão grava a regra (carteira, guia, teto, pendência, documentos) com autoria e trilha; a regra nova da mesma
//     chave encerra a anterior na véspera (nada se apaga) e a que começa no mesmo dia é recusada;
//   - na abertura do atendimento, o bloqueio da regra recusa e NENHUM atendimento é gravado; com os dados certos o
//     atendimento abre, e os alertas (teto atingido, pendência do plano), os documentos e a orientação voltam;
//   - a regra do plano superior vale para o subplano; o encerramento da vigência (pela versão) libera a abertura.
// Massa SINTÉTICA: as regras valem só para planos criados aqui (as outras aberturas da massa não as veem) e saem no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CEP_TESTE,
  CLIENTE_F22,
  CODIGO_ESTAB,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from '../cadastro/massa.spec-util.js';
import { PortaCadastroPropria } from '../cadastro/porta-propria.js';
import { PortaAtendimentoPropria } from './porta-propria.js';
import { RegraPlanoPropria } from './regra-plano-propria.js';

const PREFIXO_PLANO = `RP${MARCA}`.slice(0, 20);

describe.skipIf(SEM_BANCO)('regra própria do plano na recepção (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtendimentoPropria;
  let regras: RegraPlanoPropria;
  let m: Massa;
  let paciente = 0;
  let hoje = '';
  const planos: Record<'p' | 'filho' | 'teto' | 'pend', number> = { p: 0, filho: 0, teto: 0, pend: 0 };
  let chave = 0;

  const escrever = <T>(fn: Parameters<NucleoProprio['escrever']>[1]) =>
    nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'c2-026-preparo' }, fn) as Promise<T>;
  const ler = <T>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'c2-026-conta' }, (l) => l.uma<T>(sql, p));
  const contar = async (sql: string, p: readonly unknown[]) =>
    Number((await ler<{ n: unknown }>(sql, p))?.n ?? 0);
  const atendimentos = () =>
    contar('SELECT COUNT(*) AS n FROM atendimento WHERE paciente_id = ?', [paciente]);
  const codigo = (k: keyof typeof planos) => `${PREFIXO_PLANO}${k}`.toUpperCase();
  const ctxRegra = () => ({
    hospital: CODIGO_ESTAB,
    login: m.login,
    correlacao: 'c2-026',
    chaveIdempotencia: `c2-026-${Date.now()}-${++chave}`,
  });
  const incluir = (plano: number, extra: Record<string, unknown> = {}) =>
    regras.manter(ctxRegra(), {
      acao: 'incluir',
      fonteId: m.fonte,
      planoId: plano,
      vigenciaInicio: hoje,
      ...extra,
    });
  const abrir = (plano: keyof typeof planos, extra: Record<string, unknown> = {}) =>
    porta.executar(
      contextoPorta(m),
      'atendimento.abrirAtendimento',
      {
        tipo: 'consulta',
        paciente,
        convenio: m.fonte,
        plano: codigo(plano),
        profissional: m.profissional,
        especialidade: m.especialidade,
        unidade: m.unidade,
        centroCusto: m.centroCusto,
        procedimento: m.procedimento,
        cidPrincipal: m.cid,
        carater: 'eletivo',
        local: m.local,
        ...extra,
      },
      contextoGravacao(m),
    );
  const limparRegras = () =>
    escrever(async (e) => {
      const ids = Object.values(planos).filter((x) => x > 0);
      if (ids.length)
        await e.executar(
          `DELETE FROM regra_atendimento_fonte_pagadora WHERE plano_fonte_pagadora_id IN (${ids.map(() => '?').join(',')})`,
          ids,
        );
    });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMassa(nucleo, m);
    porta = new PortaAtendimentoPropria(nucleo, CLIENTE_F22);
    regras = new RegraPlanoPropria(nucleo, CLIENTE_F22);
    paciente = (
      await new PortaCadastroPropria(nucleo, CLIENTE_F22).cadastrar(
        contextoPorta(m),
        {
          nome: `PACIENTE DA REGRA DO PLANO ${MARCA}`,
          nascimento: '1979-02-03',
          sexo: 'F',
          cpf: cpfSintetico('990262601'),
          naturalidade: 'BELO HORIZONTE',
          ufNaturalidade: 'MG',
          cep: CEP_TESTE,
        },
        contextoGravacao(m),
      )
    ).resultado.idPaciente;
    hoje = String((await ler<{ d: unknown }>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d", []))?.d);
    await escrever(async (e) => {
      for (const k of Object.keys(planos) as (keyof typeof planos)[]) {
        const x = await e.uma<{ id: unknown }>(
          'SELECT id FROM plano_fonte_pagadora WHERE fonte_pagadora_id = ? AND codigo = ?',
          [m.fonte, codigo(k)],
        );
        planos[k] = x
          ? Number(x.id)
          : await e.inserir(
              'INSERT INTO plano_fonte_pagadora (fonte_pagadora_id, codigo, descricao, criado_em) VALUES (?, ?, ?, ?)',
              [m.fonte, codigo(k), `PLANO SINTETICO ${k} ${MARCA}`, new Date()],
            );
      }
      await e.executar('UPDATE plano_fonte_pagadora SET plano_superior_id = ? WHERE id = ?', [
        planos.p,
        planos.filho,
      ]);
    });
    await limparRegras();
  });

  afterAll(async () => {
    if (!nucleo) return;
    if (m) await limparMassa(nucleo, m).catch(() => undefined);
    await limparRegras().catch(() => undefined);
    await escrever(async (e) => {
      const ids = Object.values(planos).filter((x) => x > 0);
      if (ids.length)
        await e.executar(
          `DELETE FROM plano_fonte_pagadora WHERE id IN (${ids.map(() => '?').join(',')}) AND id NOT IN (SELECT plano_fonte_pagadora_id FROM cobertura_atendimento WHERE plano_fonte_pagadora_id IS NOT NULL)`,
          ids,
        );
    }).catch(() => undefined);
    await nucleo.encerrar();
  });

  it('inclui a regra com autoria e trilha; a nova da mesma chave encerra a anterior na véspera; mesmo dia recusa', async () => {
    const r = await incluir(planos.p, {
      exigeCarteira: true,
      tamanhoCarteira: 8,
      prefixoCarteira: '77',
      exigeGuia: true,
      documentosExigidos: ['Documento com foto'],
      orientacaoRecepcao: 'Conferir a carteira digital',
    });
    const id = r.resultado.id;
    const linha = await ler<Record<string, unknown>>(
      `SELECT exige_carteira, tamanho_carteira, prefixo_carteira, exige_guia, documentos_exigidos, estabelecimento_id,
              criado_por, versao, vigencia_fim FROM regra_atendimento_fonte_pagadora WHERE id = ?`,
      [id],
    );
    expect(linha).toMatchObject({
      tamanho_carteira: 8,
      prefixo_carteira: '77',
      estabelecimento_id: m.estabelecimento,
      criado_por: m.usuario,
      versao: 1,
      vigencia_fim: null,
    });
    expect(Number(linha?.['exige_carteira'])).toBe(1);
    const docs = linha?.['documentos_exigidos'];
    expect(typeof docs === 'string' ? JSON.parse(docs) : docs).toEqual(['Documento com foto']);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'regra_atendimento_fonte_pagadora' AND entidade_id = ?",
        [id],
      ),
    ).toBeGreaterThan(0);
    // Mesma chave começando hoje: recusa (não reescreve a regra que já vale).
    await expect(incluir(planos.p, { exigeCarteira: true })).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'regra-sobreposta' }),
    });
    // Validação do domínio na gravação: teto sem período.
    await expect(incluir(planos.teto, { tetoAtendimentos: 1 })).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'entrada-invalida', campos: ['tetoAtendimentos'] }),
    });
  });

  it('abertura: o bloqueio da regra recusa e nada é gravado; com os dados certos abre e devolve a orientação', async () => {
    const antes = await atendimentos();
    await expect(abrir('p', { matricula: '12345678', guia: 'G1' })).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'carteira-prefixo', campos: ['matricula'] }),
    });
    await expect(abrir('p', { matricula: '77123456' })).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'guia-obrigatoria', campos: ['guia'] }),
    });
    expect(await atendimentos()).toBe(antes);
    const a = await abrir('p', { matricula: '77123456', guia: 'G1' });
    expect(Number(a.resultado['reg'])).toBeGreaterThan(0);
    expect(String(a.resultado['orientacaoPlano'])).toContain('Documento com foto');
    expect(await atendimentos()).toBe(antes + 1);
    // O subplano segue a regra do plano superior.
    await expect(abrir('filho')).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'carteira-obrigatoria' }),
    });
    expect(await atendimentos()).toBe(antes + 1);
  });

  it('teto do plano e pendência em alerta: abre e avisa; a prévia diz o mesmo', async () => {
    await incluir(planos.teto, {
      tetoAtendimentos: 1,
      tetoPeriodoDias: 30,
      pendencia: 'alerta',
      pendenciaMotivo: 'Contrato em revisão',
    });
    const um = await abrir('teto');
    expect(String(um.resultado['alertaPlano'])).toBe('plano-pendente');
    const previa = await regras.previa(
      { hospital: CODIGO_ESTAB, login: m.login },
      {
        fonteId: m.fonte,
        planoId: planos.teto,
        categoriaId: null,
        pacienteId: paciente,
        carteira: null,
        validadeCarteira: null,
        guia: null,
        senhaAutorizacao: null,
        validadeSenha: null,
      },
    );
    expect(previa.atendimentosNoPeriodo).toBe(1);
    expect(previa.alertas.map((x) => x.codigo)).toEqual(['teto-plano', 'plano-pendente']);
    const dois = await abrir('teto');
    expect(String(dois.resultado['alertaPlano'])).toBe('teto-plano,plano-pendente');
    expect(String(dois.resultado['alertaPlanoMotivo'])).toContain('Contrato em revisão');
  });

  it('pendência em bloqueio recusa; encerrar a vigência (pela versão) libera; o passado não muda', async () => {
    const dia = async (n: number) =>
      String(
        (await ler<{ d: unknown }>(`SELECT DATE_FORMAT(CURDATE() - INTERVAL ${n} DAY, '%Y-%m-%d') AS d`, []))
          ?.d,
      );
    const ontem = await dia(1);
    const tres = await dia(3);
    const r = await incluir(planos.pend, {
      pendencia: 'bloqueio',
      pendenciaMotivo: 'Contrato suspenso',
      vigenciaInicio: tres,
    });
    const antes = await atendimentos();
    await expect(abrir('pend')).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'plano-pendente', campos: ['convenio'] }),
    });
    expect(await atendimentos()).toBe(antes);
    const encerrar = (versao: number, vigenciaFim: string) =>
      regras.manter(ctxRegra(), {
        acao: 'encerrar',
        fonteId: m.fonte,
        id: r.resultado.id,
        versao,
        vigenciaFim,
      });
    // Antes da véspera de hoje: o passado não muda.
    await expect(encerrar(1, await dia(2))).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'entrada-invalida', campos: ['vigenciaFim'] }),
    });
    const e = await encerrar(1, ontem);
    expect(e.resultado.versao).toBe(2);
    // A linha continua no banco, com o fim da vigência; nada apagado. A abertura passa.
    expect(
      await contar(
        'SELECT COUNT(*) AS n FROM regra_atendimento_fonte_pagadora WHERE id = ? AND vigencia_fim = ?',
        [r.resultado.id, ontem],
      ),
    ).toBe(1);
    const a = await abrir('pend');
    expect(Number(a.resultado['reg'])).toBeGreaterThan(0);
    expect(await atendimentos()).toBe(antes + 1);
    // Regra já terminada não reabre nem muda.
    await expect(encerrar(2, hoje)).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'entrada-invalida' }),
    });
    const lista = await regras.regras({ hospital: CODIGO_ESTAB, login: m.login }, m.fonte);
    expect(lista.regras.find((x) => x.id === r.resultado.id)).toMatchObject({
      vigenciaFim: ontem,
      versao: 2,
      vigente: false,
    });
    expect(lista.planos.some((x) => x.id === planos.pend)).toBe(true);
  });
});
