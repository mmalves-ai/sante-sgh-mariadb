// Contrato de efeito da herança do atendimento anterior sobre o MariaDB real (cliente f22_o1): sem regra, o padrão do
// domínio; atendimento.alterarHeranca grava regra_heranca_campo no escopo do estabelecimento ou só do usuário (a do
// usuário vence), com trilha de quem mudou o quê; nunca apaga a regra (desmarcar grava "não herda"; voltar ao padrão
// do estabelecimento encerra a pessoal); recusa a configuração lida desatualizada, o "nada a alterar", a gravação
// concorrente e a regra repetida no mesmo escopo (escopo_unico); a leitura do anterior traz a cobertura principal e o
// profissional (id) para a ficha nova. Massa SINTÉTICA, limpa no fim.
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

describe.skipIf(SEM_BANCO)('herança do atendimento anterior contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtendimentoPropria;
  let m: Massa;
  let paciente = 0;

  const linhas = () =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f32-heranca' }, (l) =>
      l.consultar(
        `SELECT campo, herda, usuario_id, versao, encerrada_em IS NOT NULL AS encerrada FROM regra_heranca_campo
          WHERE estabelecimento_id = ? ORDER BY campo, usuario_id`,
        [m.estabelecimento],
        { teto: 100 },
      ),
    );
  /**
   * A trilha das gravações da herança no estabelecimento: uma linha por operação, com quem gravou e, em
   * dados_depois.resultado.mudancas, o "herda" de antes e de depois de cada regra mudada.
   */
  const trilha = async () => {
    const ops = await nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f32-heranca-trilha' }, (l) =>
      l.consultar(
        `SELECT t.usuario_id, t.acao, CAST(t.dados_depois AS CHAR) AS depois FROM trilha_auditoria t
          WHERE t.entidade = 'regra_heranca_campo' AND t.estabelecimento_id = ? ORDER BY t.id`,
        [m.estabelecimento],
        { teto: 100 },
      ),
    );
    return ops.flatMap((t) =>
      (
        JSON.parse(
          String((JSON.parse(String(t['depois'])) as { resultado: { mudancas: string } }).resultado.mudancas),
        ) as { campo: string; antes: unknown; depois: unknown }[]
      ).map((x) => ({
        usuario_id: Number(t['usuario_id']),
        acao: t['acao'],
        campo: x.campo,
        antes: x.antes === null ? null : String(x.antes),
        depois: x.depois === null ? null : String(x.depois),
      })),
    );
  };
  const apagarRegras = () =>
    nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f32-heranca-limpa' }, async (w) => {
      await limparTrilhaDaMassa(w, { ids: [m.estabelecimento] });
      await w.executar('DELETE FROM regra_heranca_campo WHERE estabelecimento_id = ?', [m.estabelecimento]);
    });
  const marcas = async (usuario: number | null) =>
    (await porta.apoio({ ...contextoPorta(m), usuario })).heranca;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMassa(nucleo, m);
    await apagarRegras();
    porta = new PortaAtendimentoPropria(nucleo, CLIENTE_F22);
    const r = await new PortaCadastroPropria(nucleo, CLIENTE_F22).cadastrar(
      contextoPorta(m),
      {
        nome: `PACIENTE HERANCA ${MARCA}`,
        nascimento: '1980-04-05',
        sexo: 'F',
        cpf: cpfSintetico('990302101'),
        naturalidade: 'BELO HORIZONTE',
        ufNaturalidade: 'MG',
        cep: CEP_TESTE,
      },
      contextoGravacao(m),
    );
    paciente = r.resultado.idPaciente;
  });

  afterAll(async () => {
    if (m) await apagarRegras().catch(() => undefined);
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
  });

  it('sem regra gravada: o padrão do domínio (cobertura e profissional)', async () => {
    const h = await marcas(m.usuario);
    expect(Object.keys(h).filter((k) => h[k])).toEqual([
      'fonte_pagadora',
      'profissional',
      'carteira',
      'plano',
      'validade_carteira',
    ]);
  });

  it('grava no escopo do estabelecimento: uma linha por campo mudado, com trilha de quem mudou o quê', async () => {
    const r = await porta.executar(
      contextoPorta(m),
      'atendimento.alterarHeranca',
      {
        marcas: { unidade: true, convenio: false },
        versao: 'fonte_pagadora,profissional,carteira,plano,validade_carteira',
      },
      contextoGravacao(m),
    );
    expect(r.resultado['versao']).toBe('profissional,unidade,carteira,plano,validade_carteira');
    expect(r.trilha).toBeGreaterThan(0);
    expect(await linhas()).toEqual([
      { campo: 'fonte_pagadora', herda: 0, usuario_id: null, versao: 1, encerrada: 0 },
      { campo: 'unidade', herda: 1, usuario_id: null, versao: 1, encerrada: 0 },
    ]);
    expect(await trilha()).toEqual([
      expect.objectContaining({ usuario_id: m.usuario, campo: 'fonte_pagadora', depois: 'false' }),
      expect.objectContaining({ usuario_id: m.usuario, campo: 'unidade', depois: 'true' }),
    ]);
    expect((await marcas(null))['unidade']).toBe(true);
  });

  it('recusa a configuração lida desatualizada, o "nada a alterar" e a guia (fora da herança)', async () => {
    await expect(
      porta.executar(
        contextoPorta(m),
        'atendimento.alterarHeranca',
        {
          marcas: { unidade: false },
          versao: 'fonte_pagadora,profissional,carteira,plano,validade_carteira',
        },
        contextoGravacao(m),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'conflito-versao' } });
    await expect(
      porta.executar(
        contextoPorta(m),
        'atendimento.alterarHeranca',
        { marcas: { unidade: true }, versao: 'profissional,unidade,carteira,plano,validade_carteira' },
        contextoGravacao(m),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'nada-a-alterar' } });
    await expect(
      porta.executar(
        contextoPorta(m),
        'atendimento.alterarHeranca',
        { marcas: { guia: true }, versao: 'profissional,unidade,carteira,plano,validade_carteira' },
        contextoGravacao(m),
      ),
    ).rejects.toBeTruthy();
    expect(await linhas()).toHaveLength(2);
  });

  it('duas gravações concorrentes da mesma leitura: uma grava, a outra é recusada; o banco recusa a regra repetida', async () => {
    const versao = 'profissional,unidade,carteira,plano,validade_carteira';
    const gravar = () =>
      porta.executar(
        contextoPorta(m),
        'atendimento.alterarHeranca',
        { marcas: { especialidade: true }, versao },
        contextoGravacao(m),
      );
    const r = await Promise.allSettled([gravar(), gravar()]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.find((x) => x.status === 'rejected')).toMatchObject({
      reason: { problema: { codigo: 'conflito-versao' } },
    });
    expect((await linhas()).filter((x) => x['campo'] === 'especialidade')).toHaveLength(1);
    await expect(
      nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f32-heranca-repetida' }, (w) =>
        w.executar(
          `INSERT INTO regra_heranca_campo (estabelecimento_id, categoria_atendimento_id, usuario_id, campo, herda, criado_em)
           VALUES (?, NULL, NULL, 'especialidade', 0, NOW(3))`,
          [m.estabelecimento],
        ),
      ),
    ).rejects.toThrow(/uq_regra_heranca_campo_escopo_unico|Duplicate/);
  });

  it('só para mim: a regra do usuário vence a do estabelecimento, e só para ele', async () => {
    await porta.executar(
      contextoPorta(m),
      'atendimento.alterarHeranca',
      {
        marcas: { unidade: false },
        versao: 'profissional,unidade,carteira,plano,especialidade,validade_carteira',
        paraMim: true,
      },
      contextoGravacao(m),
    );
    expect((await linhas()).filter((x) => x['campo'] === 'unidade')).toEqual([
      { campo: 'unidade', herda: 1, usuario_id: null, versao: 1, encerrada: 0 },
      { campo: 'unidade', herda: 0, usuario_id: m.usuario, versao: 1, encerrada: 0 },
    ]);
    expect((await marcas(m.usuario))['unidade']).toBe(false);
    expect((await marcas(null))['unidade']).toBe(true);
    const cfg = await porta.apoio({ ...contextoPorta(m), usuario: m.usuario });
    expect(cfg.herancaEscopo).toMatchObject({
      estabelecimento: { unidade: true },
      pessoal: { unidade: false },
    });
  });

  it('com regra pessoal, o estabelecimento ainda muda o campo (compara com a regra do estabelecimento)', async () => {
    await porta.executar(
      contextoPorta(m),
      'atendimento.alterarHeranca',
      { marcas: { unidade: false }, versao: 'profissional,carteira,plano,especialidade,validade_carteira' },
      contextoGravacao(m),
    );
    expect((await linhas()).find((x) => x['campo'] === 'unidade' && x['usuario_id'] === null)).toMatchObject({
      herda: 0,
      versao: 2,
    });
  });

  it('desmarcar não apaga a regra: grava "não herda" na mesma linha (nova versão, trilha com antes e depois)', async () => {
    await porta.executar(
      contextoPorta(m),
      'atendimento.alterarHeranca',
      {
        marcas: { especialidade: false },
        versao: 'profissional,carteira,plano,especialidade,validade_carteira',
      },
      contextoGravacao(m),
    );
    expect((await linhas()).filter((x) => x['campo'] === 'especialidade')).toEqual([
      { campo: 'especialidade', herda: 0, usuario_id: null, versao: 2, encerrada: 0 },
    ]);
    expect((await trilha()).filter((x) => x['campo'] === 'especialidade').at(-1)).toMatchObject({
      usuario_id: m.usuario,
      antes: 'true',
      depois: 'false',
    });
  });

  it('voltar ao padrão do estabelecimento encerra a regra pessoal sem apagá-la', async () => {
    await porta.executar(
      contextoPorta(m),
      'atendimento.alterarHeranca',
      { marcas: { unidade: null }, versao: 'profissional,carteira,plano,validade_carteira', paraMim: true },
      contextoGravacao(m),
    );
    expect((await linhas()).filter((x) => x['campo'] === 'unidade')).toEqual([
      { campo: 'unidade', herda: 0, usuario_id: null, versao: 2, encerrada: 0 },
      { campo: 'unidade', herda: 0, usuario_id: m.usuario, versao: 2, encerrada: 1 },
    ]);
    const cfg = await porta.apoio({ ...contextoPorta(m), usuario: m.usuario });
    expect(cfg.herancaEscopo?.pessoal).toEqual({});
    await expect(
      porta.executar(
        contextoPorta(m),
        'atendimento.alterarHeranca',
        { marcas: { unidade: null }, versao: 'profissional,carteira,plano,validade_carteira' },
        contextoGravacao(m),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'escopo-invalido' } });
  });

  it('o atendimento anterior traz a cobertura principal, o profissional (id) e o centro de custo', async () => {
    await porta.executar(
      contextoPorta(m),
      'atendimento.abrirAtendimento',
      {
        tipo: 'consulta',
        paciente,
        convenio: m.fonte,
        matricula: '778899',
        validadeCarteira: '2099-12-31',
        guia: '55443322',
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
    const h = await porta.historico(contextoPorta(m), paciente);
    expect(h.anterior?.valores).toMatchObject({
      convenio: m.fonte,
      profissional: m.profissional,
      especialidade: m.especialidade,
      unidade: m.unidade,
      matricula: '778899',
      validadeCarteira: '2099-12-31',
      centroCusto: m.centroCusto,
    });
    expect(h.anterior?.valores).not.toHaveProperty('guia');
    // A fonte pagadora deixou de ser herdada no estabelecimento (segundo caso): a marca acompanha a configuração.
    expect(h.heranca).toMatchObject({
      fonte_pagadora: false,
      profissional: true,
      carteira: true,
      unidade: false,
    });
  });
});
