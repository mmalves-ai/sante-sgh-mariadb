// Contrato de efeito dos valores habituais da abertura do atendimento sobre o MariaDB real (cliente f22_o1):
// atendimento.definirPadraoAbertura grava a linha do estabelecimento e atendimento.definirMeuPadraoAbertura a do
// usuário (uma linha por escopo em padrao_abertura_atendimento), com a trilha de quem mudou o quê; limpar grava nulo
// (a linha nunca é apagada); recusa a leitura desatualizada, o "nada a alterar", o item que não existe ou não está em
// uso, a gravação concorrente e o escopo repetido (escopo_unico). A ficha do paciente SEM atendimento anterior
// recebe os valores em vigor (o do usuário vence); com atendimento anterior, o hábito só completa o que a herança
// não trouxe; o item que deixou de valer não preenche e vira aviso. Massa SINTÉTICA, limpa no fim.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CEP_TESTE,
  CLIENTE_F22,
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
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaAtendimentoPropria } from './porta-propria.js';
import { ServicoAtendimento } from './servico.js';

const CODIGO_ESPECIALIDADE = 'F32PADRAO';

describe.skipIf(SEM_BANCO)('valores habituais da abertura contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtendimentoPropria;
  let servico: ServicoAtendimento;
  let m: Massa;
  let paciente = 0;
  /** Especialidade própria do teste (para inativar sem mexer na massa comum). */
  let especialidadeDoTeste = 0;

  const linhas = () =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f32-padrao' }, (l) =>
      l.consultar(
        `SELECT usuario_id, unidade_assistencial_id AS unidade, centro_custo_id AS centro, fonte_pagadora_id AS fonte,
                especialidade_medica_id AS especialidade, versao, criado_por, alterado_por
           FROM padrao_abertura_atendimento WHERE estabelecimento_id = ? ORDER BY usuario_id`,
        [m.estabelecimento],
        { teto: 10 },
      ),
    );
  const trilha = async () => {
    const ops = await nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f32-padrao-trilha' }, (l) =>
      l.consultar(
        `SELECT t.usuario_id, CAST(t.dados_depois AS CHAR) AS depois FROM trilha_auditoria t
          WHERE t.entidade = 'padrao_abertura_atendimento' AND t.estabelecimento_id = ? ORDER BY t.id`,
        [m.estabelecimento],
        { teto: 100 },
      ),
    );
    return ops.map((t) => {
      const r = (JSON.parse(String(t['depois'])) as { resultado: { escopo: string; mudancas: string } })
        .resultado;
      return { usuario_id: Number(t['usuario_id']), escopo: r.escopo, mudancas: JSON.parse(r.mudancas) };
    });
  };
  const apagar = () =>
    nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f32-padrao-limpa' }, async (w) => {
      await limparTrilhaDaMassa(w, { ids: [m.estabelecimento] });
      await w.executar('DELETE FROM padrao_abertura_atendimento WHERE estabelecimento_id = ?', [
        m.estabelecimento,
      ]);
      await w.executar('DELETE FROM especialidade_medica WHERE codigo = ?', [CODIGO_ESPECIALIDADE]);
    });
  const definir = (
    op: 'definirPadraoAbertura' | 'definirMeuPadraoAbertura',
    valores: object,
    versao: number,
  ) => porta.executar(contextoPorta(m), `atendimento.${op}`, { valores, versao }, contextoGravacao(m));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMassa(nucleo, m);
    await apagar();
    porta = new PortaAtendimentoPropria(nucleo, CLIENTE_F22);
    servico = new ServicoAtendimento(porta);
    const r = await new PortaCadastroPropria(nucleo, CLIENTE_F22).cadastrar(
      contextoPorta(m),
      {
        nome: `PACIENTE HABITUAL ${MARCA}`,
        nascimento: '1975-08-09',
        sexo: 'M',
        cpf: cpfSintetico('990302202'),
        naturalidade: 'BELO HORIZONTE',
        ufNaturalidade: 'MG',
        cep: CEP_TESTE,
      },
      contextoGravacao(m),
    );
    paciente = r.resultado.idPaciente;
    especialidadeDoTeste = await nucleo.escrever(
      { cliente: CLIENTE_F22, correlacao: 'f32-padrao-especialidade' },
      async (w) => {
        await w.executar(
          `INSERT INTO especialidade_medica (codigo, descricao, ativo, criado_em) VALUES (?, 'ESPECIALIDADE HABITUAL DO TESTE', 1, NOW(3))`,
          [CODIGO_ESPECIALIDADE],
        );
        const x = await w.uma('SELECT id FROM especialidade_medica WHERE codigo = ?', [CODIGO_ESPECIALIDADE]);
        return Number(x?.['id']);
      },
    );
  });

  afterAll(async () => {
    if (m) await apagar().catch(() => undefined);
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
  });

  it('sem valor habitual gravado: nada no banco e a ficha do paciente novo não recebe nada', async () => {
    expect(await linhas()).toEqual([]);
    expect((await porta.apoio(contextoPorta(m))).padraoAbertura).toEqual({
      estabelecimento: null,
      pessoal: null,
      versaoEstabelecimento: 0,
      versaoPessoal: 0,
    });
    const h = await servico.historico(contextoPorta(m), paciente);
    expect(h.anterior).toBeNull();
    expect(h.padrao).toBeUndefined();
  });

  it('grava o escopo do estabelecimento: uma linha sem usuário, com a trilha de quem mudou o quê', async () => {
    const r = await definir('definirPadraoAbertura', { unidade: m.unidade, convenio: m.fonte }, 0);
    expect(r.resultado).toMatchObject({ versao: 1, escopo: 'estabelecimento', campos: 'unidade,convenio' });
    expect(r.trilha).toBeGreaterThan(0);
    expect(await linhas()).toEqual([
      {
        usuario_id: null,
        unidade: m.unidade,
        centro: null,
        fonte: m.fonte,
        especialidade: null,
        versao: 1,
        criado_por: m.usuario,
        alterado_por: null,
      },
    ]);
    expect(await trilha()).toEqual([
      {
        usuario_id: m.usuario,
        escopo: 'estabelecimento',
        mudancas: [
          { campo: 'unidade', antes: null, depois: m.unidade },
          { campo: 'convenio', antes: null, depois: m.fonte },
        ],
      },
    ]);
  });

  it('grava o escopo do usuário: outra linha, só dele; o estabelecimento não muda', async () => {
    const r = await definir(
      'definirMeuPadraoAbertura',
      { centroCusto: m.centroCusto, especialidade: especialidadeDoTeste, unidade: m.unidade },
      0,
    );
    expect(r.resultado).toMatchObject({ versao: 1, escopo: 'usuario' });
    const l = await linhas();
    expect(l).toHaveLength(2);
    expect(l.find((x) => x['usuario_id'] === m.usuario)).toMatchObject({
      unidade: m.unidade,
      centro: m.centroCusto,
      fonte: null,
      especialidade: especialidadeDoTeste,
      versao: 1,
    });
    expect(l.find((x) => x['usuario_id'] === null)).toMatchObject({ versao: 1, centro: null });
    // Outra pessoa (sem usuário na sessão) só enxerga o do estabelecimento.
    const outro = (await porta.apoio({ ...contextoPorta(m), usuario: null })).padraoAbertura;
    expect(outro?.pessoal).toBeNull();
    expect(outro?.estabelecimento?.unidade).toMatchObject({ id: m.unidade, vale: true });
  });

  it('paciente sem atendimento anterior: a ficha recebe os valores em vigor (o do usuário vence)', async () => {
    const h = await servico.historico(contextoPorta(m), paciente);
    expect(h.anterior).toBeNull();
    expect(h.padrao).toEqual({
      valores: {
        unidade: m.unidade,
        centroCusto: m.centroCusto,
        convenio: m.fonte,
        especialidade: especialidadeDoTeste,
      },
      origens: {
        unidade: 'usuario',
        centroCusto: 'usuario',
        convenio: 'estabelecimento',
        especialidade: 'usuario',
      },
      avisos: [],
    });
    const cfg = await servico.configuracaoPadraoAbertura(contextoPorta(m));
    expect(cfg.versaoEstabelecimento).toBe(1);
    expect(cfg.versaoPessoal).toBe(1);
    expect(cfg.campos.find((c) => c.campo === 'convenio')).toMatchObject({
      pessoal: null,
      estabelecimento: { id: m.fonte, vale: true },
      emVigor: { id: m.fonte, origem: 'estabelecimento' },
    });
  });

  it('recusa a leitura desatualizada, o "nada a alterar" e o item que não existe; nada é gravado', async () => {
    await expect(definir('definirPadraoAbertura', { centroCusto: m.centroCusto }, 0)).rejects.toMatchObject({
      problema: { codigo: 'conflito-versao' },
    });
    await expect(definir('definirPadraoAbertura', { unidade: m.unidade }, 1)).rejects.toMatchObject({
      problema: { codigo: 'nada-a-alterar' },
    });
    await expect(definir('definirMeuPadraoAbertura', { unidade: 987_654_321_012 }, 1)).rejects.toMatchObject({
      problema: { codigo: 'padrao-invalido' },
    });
    await expect(definir('definirMeuPadraoAbertura', { local: m.local }, 1)).rejects.toBeTruthy();
    const l = await linhas();
    expect(l.map((x) => x['versao'])).toEqual([1, 1]);
    expect(await trilha()).toHaveLength(2);
  });

  it('o item que deixou de valer não preenche a ficha e vira aviso; não pode mais ser escolhido', async () => {
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f32-padrao-inativa' }, (w) =>
      w.executar('UPDATE especialidade_medica SET ativo = 0 WHERE id = ?', [especialidadeDoTeste]),
    );
    const h = await servico.historico(contextoPorta(m), paciente);
    expect(h.padrao?.valores).toEqual({ unidade: m.unidade, centroCusto: m.centroCusto, convenio: m.fonte });
    expect(h.padrao?.avisos).toEqual([
      'Especialidade habitual dos seus valores habituais (ESPECIALIDADE HABITUAL DO TESTE) não está mais em uso: escolha outro valor.',
    ]);
    await expect(
      definir('definirPadraoAbertura', { especialidade: especialidadeDoTeste }, 1),
    ).rejects.toMatchObject({ problema: { codigo: 'padrao-invalido' } });
  });

  it('limpar o campo grava nulo na mesma linha (nunca apaga), com a trilha do antes e do depois', async () => {
    const r = await definir('definirMeuPadraoAbertura', { especialidade: null, unidade: null }, 1);
    expect(r.resultado).toMatchObject({ versao: 2, campos: 'unidade,especialidade' });
    const l = await linhas();
    expect(l).toHaveLength(2);
    expect(l.find((x) => x['usuario_id'] === m.usuario)).toMatchObject({
      unidade: null,
      centro: m.centroCusto,
      especialidade: null,
      versao: 2,
      alterado_por: m.usuario,
    });
    expect((await trilha()).at(-1)).toEqual({
      usuario_id: m.usuario,
      escopo: 'usuario',
      mudancas: [
        { campo: 'unidade', antes: m.unidade, depois: null },
        { campo: 'especialidade', antes: especialidadeDoTeste, depois: null },
      ],
    });
    // Sem o valor pessoal, volta a valer o do estabelecimento.
    const h = await servico.historico(contextoPorta(m), paciente);
    expect(h.padrao?.origens).toMatchObject({ unidade: 'estabelecimento', centroCusto: 'usuario' });
    expect(h.padrao?.avisos).toEqual([]);
  });

  it('duas gravações concorrentes da mesma leitura: uma grava, a outra é recusada; o banco recusa o escopo repetido', async () => {
    const gravar = () => definir('definirPadraoAbertura', { centroCusto: m.centroCusto }, 1);
    const r = await Promise.allSettled([gravar(), gravar()]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((x) => x.status === 'rejected')).toMatchObject({
      reason: { problema: { codigo: 'conflito-versao' } },
    });
    expect((await linhas()).find((x) => x['usuario_id'] === null)).toMatchObject({ versao: 2 });
    await expect(
      nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f32-padrao-repetido' }, (w) =>
        w.executar(
          'INSERT INTO padrao_abertura_atendimento (estabelecimento_id, usuario_id, criado_em) VALUES (?, NULL, NOW(3))',
          [m.estabelecimento],
        ),
      ),
    ).rejects.toThrow(/uq_padrao_abertura_atendimento_escopo_unico|Duplicate/);
  });

  it('com atendimento anterior, o hábito só completa o que a herança não trouxe', async () => {
    await porta.executar(
      contextoPorta(m),
      'atendimento.abrirAtendimento',
      {
        tipo: 'consulta',
        paciente,
        convenio: m.fonte,
        matricula: '112233',
        validadeCarteira: '2099-12-31',
        profissional: m.profissional,
        especialidade: m.especialidade,
        unidade: m.unidade,
        centroCusto: m.centroCusto,
        procedimento: m.procedimento,
        cidPrincipal: m.cid,
        carater: 'eletivo',
        local: m.local,
      },
      contextoGravacao(m),
    );
    const h = await servico.historico(contextoPorta(m), paciente);
    // Sem regra de herança gravada: convênio, profissional e cobertura vêm do anterior; unidade e centro de custo não.
    expect(h.anterior?.herdados).toMatchObject({ convenio: m.fonte, profissional: m.profissional });
    expect(h.anterior?.herdados).not.toHaveProperty('unidade');
    expect(h.padrao?.valores).toEqual({ unidade: m.unidade, centroCusto: m.centroCusto });
    expect(h.padrao?.origens).toEqual({ unidade: 'estabelecimento', centroCusto: 'usuario' });
  });
});
