// Contrato de efeito do módulo de recepção tirado da ORIGEM da abertura (F3.1, 02-CAD linha 2) contra o MariaDB real
// (cliente de teste; f22_o1 por padrão). Sem local de atendimento na abertura, a regra de campo do cadastro vale no
// módulo do canal de entrada (modulo_recepcao.canal_entrada: o pronto atendimento é a urgência) ou do guichê que o
// usuário ocupa na sessão (agenda e demanda espontânea). Prova o que fica no banco: recusada pela regra do módulo da
// origem, NENHUM atendimento é gravado; fora do módulo, abre. A conferência da tela (moduloRecepcaoDaAbertura) resolve
// o mesmo módulo. Massa SINTÉTICA; módulos, guichê, ocupação e regras saem no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
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
import { moduloRecepcaoDaAbertura } from '../cadastro/campos-abertura.js';
import { FichaComplementarPropria } from '../cadastro/ficha-complementar-proprio.js';
import { PortaCadastroPropria } from '../cadastro/porta-propria.js';
import { PortaAtendimentoPropria } from './porta-propria.js';

const ROTULO = `REGRA ORIGEM ${MARCA}`;
const COD_URGENCIA = `ORIG-URG-${MARCA}`.slice(0, 30);
const COD_GUICHE = `ORIG-GUI-${MARCA}`.slice(0, 30);
const NUMERO_GUICHE = 9871;

describe.skipIf(SEM_BANCO)('módulo de recepção pela origem da abertura (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtendimentoPropria;
  let ficha: FichaComplementarPropria;
  let m: Massa;
  let paciente = 0;
  let moduloUrgencia = 0;
  let moduloGuiche = 0;
  let guiche = 0;

  const escrever = <T>(fn: Parameters<NucleoProprio['escrever']>[1]) =>
    nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f31-01-origem-preparo' }, fn) as Promise<T>;
  const atendimentosDe = (p: number) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f31-01-origem-conta' }, async (l) =>
      Number(
        (await l.uma<{ n: unknown }>('SELECT COUNT(*) AS n FROM atendimento WHERE paciente_id = ?', [p]))
          ?.n ?? 0,
      ),
    );
  const limparRegras = () =>
    escrever(async (e) => {
      await e.executar('DELETE FROM regra_campo_cadastro WHERE rotulo = ?', [ROTULO]);
    });
  const regra = (campo: string, modulo: number) =>
    escrever(async (e) => {
      await e.executar(
        `INSERT INTO regra_campo_cadastro (estabelecimento_id, entidade, campo, modulo_recepcao_id, tipo_atendimento,
                                           fonte_pagadora_id, exigencia, rotulo, ativo, criado_em)
         VALUES (?, 'paciente', ?, ?, 'todos', NULL, 'obrigatorio', ?, TRUE, ?)`,
        [m.estabelecimento, campo, modulo, ROTULO, new Date()],
      );
    });
  const modulo = (codigo: string) =>
    escrever<number>(async (e) => {
      const x = await e.uma<{ id: unknown }>('SELECT id FROM modulo_recepcao WHERE codigo = ?', [codigo]);
      return x
        ? Number(x.id)
        : await e.inserir('INSERT INTO modulo_recepcao (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
            codigo,
            `MODULO SINTETICO ${codigo}`,
            new Date(),
          ]);
    });
  const canal = (id: number, c: string | null) =>
    escrever(async (e) => {
      await e.executar('UPDATE modulo_recepcao SET canal_entrada = ? WHERE id = ?', [c, id]);
    });
  const ocupar = (sim: boolean) =>
    escrever(async (e) => {
      await e.executar('DELETE FROM ocupacao_guiche WHERE guiche_recepcao_id = ?', [guiche]);
      if (sim)
        await e.executar(
          `INSERT INTO ocupacao_guiche (guiche_recepcao_id, operacao, ocorrido_em, usuario_id, ocupante_usuario_id,
                                        local_atendimento_id, inicio_em, criado_em)
           VALUES (?, 'inclusao', ?, ?, ?, NULL, ?, ?)`,
          [guiche, new Date(), m.usuario, m.usuario, new Date(), new Date()],
        );
    });
  const abrir = (extra: Record<string, unknown> = {}) =>
    porta.executar(
      contextoPorta(m),
      'atendimento.abrirAtendimento',
      {
        tipo: 'consulta',
        paciente,
        convenio: m.fonte,
        matricula: '123456',
        profissional: m.profissional,
        especialidade: m.especialidade,
        unidade: m.unidade,
        centroCusto: m.centroCusto,
        procedimento: m.procedimento,
        cidPrincipal: m.cid,
        carater: 'eletivo',
        ...extra,
      },
      contextoGravacao(m),
    );
  const incompleto = (campos: string[]) => ({
    problema: expect.objectContaining({ codigo: 'cadastro-incompleto', campos }),
  });
  const resolver = (o: Parameters<typeof moduloRecepcaoDaAbertura>[2]) =>
    ficha.lerNoEstabelecimento(contextoPorta(m), (l, est) => moduloRecepcaoDaAbertura(l, est, o));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMassa(nucleo, m);
    await limparRegras();
    porta = new PortaAtendimentoPropria(nucleo, CLIENTE_F22);
    ficha = new FichaComplementarPropria(nucleo as never, CLIENTE_F22);
    paciente = (
      await new PortaCadastroPropria(nucleo, CLIENTE_F22).cadastrar(
        contextoPorta(m),
        {
          nome: `PACIENTE DA ORIGEM ${MARCA}`,
          nascimento: '1979-02-03',
          sexo: 'F',
          cpf: cpfSintetico('990131201'),
          naturalidade: 'BELO HORIZONTE',
          ufNaturalidade: 'MG',
          cep: CEP_TESTE,
        },
        contextoGravacao(m),
      )
    ).resultado.idPaciente;
    moduloUrgencia = await modulo(COD_URGENCIA);
    moduloGuiche = await modulo(COD_GUICHE);
    guiche = await escrever<number>(async (e) => {
      // O guichê sintético representa um local do estabelecimento da massa que trabalha no módulo do guichê: um local
      // novo do mesmo ponto de recepção do local da massa (o local da massa fica sem módulo).
      const pr = await e.uma<{ p: unknown }>(
        'SELECT ponto_recepcao_id AS p FROM local_atendimento WHERE id = ?',
        [m.local],
      );
      const cod = `ORIGL${MARCA}`.slice(0, 20);
      const lx = await e.uma<{ id: unknown }>(
        'SELECT id FROM local_atendimento WHERE estabelecimento_id = ? AND codigo = ?',
        [m.estabelecimento, cod],
      );
      const local = lx
        ? Number(lx.id)
        : await e.inserir(
            `INSERT INTO local_atendimento (estabelecimento_id, codigo, descricao, ponto_recepcao_id, criado_em)
             VALUES (?, ?, ?, ?, ?)`,
            [m.estabelecimento, cod, `LOCAL SINTETICO ${MARCA}`, pr?.p, new Date()],
          );
      await e.executar('UPDATE local_atendimento SET modulo_recepcao_id = ? WHERE id = ?', [
        moduloGuiche,
        local,
      ]);
      const gx = await e.uma<{ id: unknown }>(
        'SELECT id FROM guiche_recepcao WHERE ponto_recepcao_id = ? AND numero = ?',
        [pr?.p, NUMERO_GUICHE],
      );
      return gx
        ? Number(gx.id)
        : await e.inserir(
            `INSERT INTO guiche_recepcao (ponto_recepcao_id, numero, descricao, local_atendimento_id, criado_em)
             VALUES (?, ?, ?, ?, ?)`,
            [pr?.p, NUMERO_GUICHE, `GUICHE SINTETICO ${MARCA}`, local, new Date()],
          );
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    if (m) {
      await limparRegras().catch(() => undefined);
      await escrever(async (e) => {
        if (guiche) {
          await e.executar('DELETE FROM ocupacao_guiche WHERE guiche_recepcao_id = ?', [guiche]);
          const g = await e.uma<{ l: unknown }>(
            'SELECT local_atendimento_id AS l FROM guiche_recepcao WHERE id = ?',
            [guiche],
          );
          await e.executar('DELETE FROM guiche_recepcao WHERE id = ?', [guiche]);
          if (g?.l) await e.executar('DELETE FROM local_atendimento WHERE id = ?', [g.l]);
        }
        await e.executar('DELETE FROM modulo_recepcao WHERE id IN (?, ?)', [moduloUrgencia, moduloGuiche]);
      }).catch(() => undefined);
      await limparMassa(nucleo, m).catch(() => undefined);
    }
    await nucleo.encerrar();
  });

  it('canal de entrada: o pronto atendimento sem local usa o módulo da urgência; recusado, nada é gravado', async () => {
    await regra('nomeMae', moduloUrgencia);
    try {
      await escrever(async (e) => {
        await e.executar(
          'UPDATE pessoa_fisica pf JOIN paciente p ON p.pessoa_fisica_id = pf.id SET pf.nome_mae = NULL, pf.mae_desconhecida = FALSE WHERE p.id = ?',
          [paciente],
        );
      });
      // Sem canal declarado, o módulo da urgência não vale para o pronto atendimento: abre.
      const n = await atendimentosDe(paciente);
      await abrir({ tipo: 'pa', carater: 'urgencia' });
      expect(await atendimentosDe(paciente)).toBe(n + 1);
      expect(await resolver({ tipoAtendimento: 'urgencia' })).toEqual({ modulo: null, fonte: null });

      // O módulo declara o canal da urgência: o mesmo pronto atendimento é recusado e nada é gravado.
      await canal(moduloUrgencia, 'urgencia');
      expect(await resolver({ tipoAtendimento: 'urgencia' })).toEqual({
        modulo: moduloUrgencia,
        fonte: 'canal',
      });
      await expect(abrir({ tipo: 'pa', carater: 'urgencia' })).rejects.toMatchObject(incompleto(['nomeMae']));
      expect(await atendimentosDe(paciente)).toBe(n + 1);
      // A consulta da demanda espontânea é outro canal: abre.
      await abrir();
      expect(await atendimentosDe(paciente)).toBe(n + 2);
      // Marcação e senha inexistentes não trazem módulo: vale o canal (as leituras da origem rodam no banco).
      expect(
        await resolver({ tipoAtendimento: 'urgencia', marcacao: 2147483000, senha: 2147483000 }),
      ).toEqual({
        modulo: moduloUrgencia,
        fonte: 'canal',
      });
    } finally {
      await canal(moduloUrgencia, null);
      await limparRegras();
    }
  });

  it('guichê da sessão: a consulta sem local usa o módulo do guichê ocupado; a urgência segue o canal', async () => {
    await regra('email', moduloGuiche);
    await canal(moduloUrgencia, 'urgencia');
    try {
      await ocupar(false);
      const n = await atendimentosDe(paciente);
      // Sem guichê ocupado, a consulta abre.
      await abrir();
      expect(await atendimentosDe(paciente)).toBe(n + 1);

      // O usuário ocupa o guichê cujo local trabalha no módulo do guichê: a consulta é recusada, nada é gravado.
      await ocupar(true);
      expect(await resolver({ tipoAtendimento: 'ambulatorial', usuario: m.usuario })).toEqual({
        modulo: moduloGuiche,
        fonte: 'guiche',
      });
      await expect(abrir()).rejects.toMatchObject(incompleto(['email']));
      expect(await atendimentosDe(paciente)).toBe(n + 1);
      // O pronto atendimento é do canal da urgência (o ato decide): a regra do guichê não vale, e abre.
      await abrir({ tipo: 'pa', carater: 'urgencia' });
      expect(await atendimentosDe(paciente)).toBe(n + 2);
      // O módulo informado vem antes do guichê; o local explícito, antes de tudo.
      expect(
        await resolver({ tipoAtendimento: 'ambulatorial', usuario: m.usuario, modulo: moduloUrgencia }),
      ).toEqual({ modulo: moduloUrgencia, fonte: 'informado' });

      // Guichê fechado: a consulta volta a abrir.
      await ocupar(false);
      await abrir();
      expect(await atendimentosDe(paciente)).toBe(n + 3);
    } finally {
      await ocupar(false);
      await canal(moduloUrgencia, null);
      await limparRegras();
    }
  });
});
