// Contrato de efeito da herança do atendimento anterior sobre o MariaDB real (cliente f22_o1): sem regra, o padrão do
// domínio; atendimento.alterarHeranca grava regra_heranca_campo no escopo do estabelecimento ou só do usuário (a do
// usuário vence), nunca apaga a regra (desmarcar grava "não herda"), recusa a configuração lida desatualizada e o
// "nada a alterar"; a leitura do anterior traz a cobertura principal para a ficha nova. Massa SINTÉTICA, limpa no fim.
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
import { PortaAtendimentoPropria } from './porta-propria.js';

describe.skipIf(SEM_BANCO)('herança do atendimento anterior contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtendimentoPropria;
  let m: Massa;
  let paciente = 0;

  const linhas = () =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f32-heranca' }, (l) =>
      l.consultar(
        'SELECT campo, herda, usuario_id, versao FROM regra_heranca_campo WHERE estabelecimento_id = ? ORDER BY campo, usuario_id',
        [m.estabelecimento],
        { teto: 100 },
      ),
    );
  const apagarRegras = () =>
    nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f32-heranca-limpa' }, (w) =>
      w.executar('DELETE FROM regra_heranca_campo WHERE estabelecimento_id = ?', [m.estabelecimento]),
    );
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

  it('grava no escopo do estabelecimento: uma linha por campo mudado, com trilha', async () => {
    const r = await porta.executar(
      contextoPorta(m),
      'atendimento.alterarHeranca',
      {
        marcas: { guia: true, convenio: false },
        versao: 'fonte_pagadora,profissional,carteira,plano,validade_carteira',
      },
      contextoGravacao(m),
    );
    expect(r.resultado['versao']).toBe('profissional,carteira,guia,plano,validade_carteira');
    expect(r.trilha).toBeGreaterThan(0);
    expect(await linhas()).toEqual([
      { campo: 'fonte_pagadora', herda: 0, usuario_id: null, versao: 1 },
      { campo: 'guia', herda: 1, usuario_id: null, versao: 1 },
    ]);
    expect((await marcas(null))['guia']).toBe(true);
  });

  it('recusa a configuração lida desatualizada e o "nada a alterar"', async () => {
    await expect(
      porta.executar(
        contextoPorta(m),
        'atendimento.alterarHeranca',
        { marcas: { guia: false }, versao: 'fonte_pagadora,profissional,carteira,plano,validade_carteira' },
        contextoGravacao(m),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'conflito-versao' } });
    await expect(
      porta.executar(
        contextoPorta(m),
        'atendimento.alterarHeranca',
        { marcas: { guia: true }, versao: 'profissional,carteira,guia,plano,validade_carteira' },
        contextoGravacao(m),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'nada-a-alterar' } });
    expect(await linhas()).toHaveLength(2);
  });

  it('só para mim: a regra do usuário vence a do estabelecimento, e só para ele', async () => {
    await porta.executar(
      contextoPorta(m),
      'atendimento.alterarHeranca',
      {
        marcas: { guia: false },
        versao: 'profissional,carteira,guia,plano,validade_carteira',
        paraMim: true,
      },
      contextoGravacao(m),
    );
    expect(await linhas()).toEqual([
      { campo: 'fonte_pagadora', herda: 0, usuario_id: null, versao: 1 },
      { campo: 'guia', herda: 1, usuario_id: null, versao: 1 },
      { campo: 'guia', herda: 0, usuario_id: m.usuario, versao: 1 },
    ]);
    expect((await marcas(m.usuario))['guia']).toBe(false);
    expect((await marcas(null))['guia']).toBe(true);
  });

  it('desmarcar não apaga a regra: altera a linha do escopo (nova versão)', async () => {
    await porta.executar(
      contextoPorta(m),
      'atendimento.alterarHeranca',
      { marcas: { convenio: true }, versao: 'profissional,carteira,plano,validade_carteira' },
      contextoGravacao(m),
    );
    expect(await linhas()).toEqual([
      { campo: 'fonte_pagadora', herda: 1, usuario_id: null, versao: 2 },
      { campo: 'guia', herda: 1, usuario_id: null, versao: 1 },
      { campo: 'guia', herda: 0, usuario_id: m.usuario, versao: 1 },
    ]);
  });

  it('o atendimento anterior traz a cobertura principal e o centro de custo para a ficha nova', async () => {
    await porta.executar(
      contextoPorta(m),
      'atendimento.abrirAtendimento',
      {
        tipo: 'consulta',
        paciente,
        convenio: m.fonte,
        matricula: '778899',
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
      matricula: '778899',
      centroCusto: m.centroCusto,
    });
  });
});
