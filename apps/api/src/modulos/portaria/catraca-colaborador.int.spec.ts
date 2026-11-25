// Contrato de efeito do crachá do colaborador na catraca (08-INTG L141) contra o MariaDB real (cliente f22_o3, massa
// SINTÉTICA "L0218" sobre a massa de pessoas da onda 3; nenhuma pessoa real): o crachá ligado à matrícula
// (vinculo_trabalho.codigo_cracha), a regra de acesso do terminal pela versão (regra_acesso_dispositivo, nunca apagada)
// e a passagem gravada em evento_acesso_portaria com o colaborador, a regra e o motivo da recusa. No fim, a massa da
// catraca e a trilha dos estabelecimentos sintéticos são apagadas. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { avaliarCatraca, avaliarColaboradorNaCatraca } from '@sgh/dominio-internacao';
import { type ContextoNucleo, type Escritor, ErroOperacao } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrilhaDaGravacao } from '../exames/public-api.js';
import { civil } from '../exames/relogio.js';
import {
  ctxO3,
  encerrarMassaO3,
  type MassaPessoasO3,
  prepararMassaO3,
  SEM_BANCO_O3,
} from '../pessoas/avaliacao/massa.spec-util.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaPortariaPropria } from './porta-propria.js';
import type { NovaRegraAcesso } from './tipos.js';

const P = 'L0218';
const CRACHA = 'L0218QCOLAB01';

async function recusada(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e);
  }
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO_O3)('crachá do colaborador na catraca (MariaDB, cliente f22_o3)', () => {
  let m: MassaPessoasO3;
  let porta: PortaPortariaPropria;
  let ctx: ContextoNucleo;
  const ids = { modelo: 0, setorUti: 0, setorRecepcao: 0, perfil: 0, terminal: 0 };
  const agora = () => {
    const c = civil(new Date());
    return `${c.data}T${c.hora}`;
  };
  const trilha =
    (entidade: string) =>
    (r: unknown): TrilhaDaGravacao => ({
      estabelecimento: ctx.estabelecimento,
      usuario: ctx.usuario,
      acao: 'operacao',
      entidade,
      entidadeId: (r as { id?: number })?.id ?? null,
      dadosDepois: { evento: 'teste-l0218' },
      correlacao: 'teste-l0218',
    });

  const limpar = async (e: Escritor) => {
    const ests = [m.est, m.outro];
    await e.executar(
      'DELETE ev FROM evento_acesso_portaria ev JOIN terminal_acesso t ON t.id = ev.terminal_acesso_id JOIN ponto_acesso p ON p.id = t.ponto_acesso_id WHERE p.estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar(
      'DELETE r FROM regra_acesso_dispositivo r JOIN terminal_acesso t ON t.id = r.terminal_acesso_id JOIN ponto_acesso p ON p.id = t.ponto_acesso_id WHERE p.estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar(
      'DELETE t FROM terminal_acesso t JOIN ponto_acesso p ON p.id = t.ponto_acesso_id WHERE p.estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar('DELETE FROM ponto_acesso WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar('DELETE FROM usuario_perfil WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      'UPDATE vinculo_trabalho SET codigo_cracha = NULL, setor_funcional_id = NULL WHERE estabelecimento_id IN (?, ?)',
      ests,
    );
    await limparTrilhaDaMassa(e, { ids: ests });
  };

  beforeAll(async () => {
    m = await prepararMassaO3('Q');
    ctx = ctxO3(m.est, m.usuario);
    porta = new PortaPortariaPropria(m.nucleo);
    await m.nucleo.escrever({ cliente: ctx.cliente, correlacao: 'preparo-teste-l0218' }, async (e) => {
      const agoraD = new Date();
      await limpar(e);
      const fab = await garantir(
        e,
        'SELECT id FROM fabricante_terminal_acesso WHERE codigo = ?',
        [`${P}-FAB`],
        "INSERT INTO fabricante_terminal_acesso (codigo, descricao, criado_em) VALUES (?, 'FABRICANTE SINTETICO L0218', ?)",
        [`${P}-FAB`, agoraD],
      );
      ids.modelo = await garantir(
        e,
        'SELECT id FROM modelo_terminal_acesso WHERE codigo = ?',
        [`${P}-CAT`],
        "INSERT INTO modelo_terminal_acesso (codigo, descricao, fabricante_terminal_acesso_id, tipo, criado_em) VALUES (?, 'CATRACA L0218', ?, 'catraca', ?)",
        [`${P}-CAT`, fab, agoraD],
      );
      const setor = (codigo: string, nome: string) =>
        garantir(
          e,
          'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
          [m.est, codigo],
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'assistencial', ?)",
          [m.est, codigo, nome, agoraD],
        );
      ids.setorUti = await setor(`${P}-UTI`, 'UTI SINTETICA L0218');
      ids.setorRecepcao = await setor(`${P}-REC`, 'RECEPCAO SINTETICA L0218');
      ids.perfil = await garantir(
        e,
        'SELECT id FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id = ?',
        [`${P}-ENF`, m.est],
        "INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, 'ENFERMAGEM SINTETICA L0218', ?)",
        [m.est, `${P}-ENF`, agoraD],
      );
      await e.executar(
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [m.usuario, ids.perfil, m.est, '2020-01-01', agoraD],
      );
      await e.executar('UPDATE vinculo_trabalho SET setor_funcional_id = ? WHERE id = ?', [
        ids.setorUti,
        m.vinculo,
      ]);
    });
    ids.terminal = (
      await porta.gravarSgh(ctx, trilha('terminal_acesso'), (g) =>
        g.configurarTerminal({
          id: null,
          versao: null,
          nome: 'CATRACA L0218',
          tipoTerminal: ids.modelo,
          fabricante: 0,
          local: 'PORTARIA L0218',
          sentido: 'ambos',
          ativo: true,
          usuario: 'x',
        }),
      )
    ).id;
  }, 60_000);

  afterAll(async () => {
    if (!m) return;
    await m.nucleo.escrever({ cliente: ctx.cliente, correlacao: 'limpeza-teste-l0218' }, limpar);
    await encerrarMassaO3(m);
  }, 60_000);

  const ler = <T>(sql: string, p: unknown[]) =>
    m.nucleo.lerSomente({ cliente: ctx.cliente, correlacao: 'conferencia-l0218' }, (l) =>
      l.uma<T & Record<string, unknown>>(sql, p),
    );
  const cracha = (c: string | null, matricula = `L0302QM`) =>
    porta.gravarSgh(ctx, trilha('vinculo_trabalho'), (g) =>
      g.vincularCrachaColaborador({ matricula, cracha: c, usuario: 'x' }),
    );
  const regra = (r: Partial<NovaRegraAcesso>) =>
    porta.gravarSgh(ctx, trilha('regra_acesso_dispositivo'), (g) =>
      g.gravarRegraAcesso({
        id: null,
        versao: null,
        terminal: ids.terminal,
        perfil: null,
        setor: null,
        diasSemana: [1, 2, 3, 4, 5, 6, 7],
        horaInicio: '00:00',
        horaFim: '00:00',
        entrada: true,
        saida: true,
        vigenciaInicio: '2020-01-01',
        vigenciaFim: null,
        prioridade: 0,
        ativo: true,
        usuario: 'x',
        ...r,
      }),
    );
  // A mesma avaliação do controller: o colaborador pela regra de acesso; o crachá sem colaborador, pela visita.
  const passar = (chave: string, sentido: 'entrada' | 'saida' = 'entrada') => {
    const ocorridoEm = agora();
    return porta.gravarSgh(ctx, trilha('evento_acesso_portaria'), (g) =>
      g.registrarEventoCatraca(
        { terminal: ids.terminal, cracha: CRACHA, sentido, ocorridoEm, chave, usuario: 'x' },
        (x) =>
          x.colaborador
            ? {
                ...avaliarColaboradorNaCatraca({
                  colaborador: x.colaborador,
                  regras: x.regras,
                  agora: ocorridoEm.slice(0, 16),
                  sentido,
                  terminal: x.terminal,
                }),
                encerra: false,
              }
            : avaliarCatraca({ visita: x.visita, agora: ocorridoEm, sentido, terminal: x.terminal }),
      ),
    );
  };
  const gravado = (id: number) =>
    ler<{
      resultado: string;
      colaborador_id: number | null;
      regra_acesso_dispositivo_id: number | null;
      motivo_recusa: string | null;
      codigo_cracha: string;
    }>(
      'SELECT resultado, colaborador_id, regra_acesso_dispositivo_id, motivo_recusa, codigo_cracha FROM evento_acesso_portaria WHERE id = ?',
      [id],
    );

  it('o crachá liga à matrícula do estabelecimento; matrícula desconhecida recusa', async () => {
    expect(await recusada(cracha(CRACHA, 'L0218NAOEXISTE'))).toBe('matricula-desconhecida');
    expect(await cracha(CRACHA)).toEqual({ id: m.vinculo });
    expect(
      await ler<{ codigo_cracha: string; versao: number }>(
        'SELECT codigo_cracha FROM vinculo_trabalho WHERE id = ?',
        [m.vinculo],
      ),
    ).toMatchObject({ codigo_cracha: CRACHA });
  });

  it('sem regra no terminal, a passagem é recusada e grava o colaborador; uma vez por chave', async () => {
    const ev = await passar('l0218-sem-regra');
    expect(ev).toMatchObject({
      resultado: 'negado',
      motivo: 'sem-regra',
      colaborador: m.colaborador,
      visita: null,
      repetido: false,
    });
    expect(await passar('l0218-sem-regra')).toEqual({ ...ev, repetido: true });
    expect(await gravado(ev.id)).toMatchObject({
      resultado: 'recusado',
      colaborador_id: m.colaborador,
      regra_acesso_dispositivo_id: null,
      motivo_recusa: 'sem-regra',
      codigo_cracha: CRACHA,
    });
  });

  it('regra pela versão: a de maior prioridade recusa pelo setor, a do perfil libera; desativada, deixa de valer', async () => {
    const r1 = await regra({ setor: ids.setorRecepcao, prioridade: 10 });
    expect(r1.versao).toBe(1);
    const negado = await passar('l0218-setor');
    expect(negado).toMatchObject({ resultado: 'negado', motivo: 'setor-nao-permitido' });
    expect(await gravado(negado.id)).toMatchObject({
      resultado: 'recusado',
      regra_acesso_dispositivo_id: r1.id,
      motivo_recusa: 'setor-nao-permitido',
    });

    const r2 = await regra({ perfil: ids.perfil, setor: ids.setorUti, entrada: true, saida: false });
    const liberado = await passar('l0218-perfil');
    expect(liberado).toMatchObject({ resultado: 'liberado', motivo: null, colaborador: m.colaborador });
    expect(await gravado(liberado.id)).toMatchObject({
      resultado: 'permitido',
      colaborador_id: m.colaborador,
      regra_acesso_dispositivo_id: r2.id,
      motivo_recusa: null,
    });
    // A saída não é permitida pela regra do perfil: a recusa vem da regra de maior prioridade.
    expect(await passar('l0218-saida', 'saida')).toMatchObject({
      resultado: 'negado',
      motivo: 'setor-nao-permitido',
    });

    const lidas = await porta.regrasAcesso(ctx);
    expect(lidas.find((x) => x.id === r2.id)).toEqual({
      id: r2.id,
      terminal: ids.terminal,
      perfil: ids.perfil,
      setor: ids.setorUti,
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horaInicio: '00:00',
      horaFim: '00:00',
      entrada: true,
      saida: false,
      vigenciaInicio: '2020-01-01',
      vigenciaFim: null,
      prioridade: 0,
      ativo: true,
      versao: 1,
    });
    expect(await regra({ id: r2.id, versao: 1, perfil: ids.perfil, ativo: false })).toEqual({
      id: r2.id,
      versao: 2,
    });
    expect(await recusada(regra({ id: r2.id, versao: 1, ativo: true }))).toBe('regra-mudou');
    expect(await passar('l0218-desativada')).toMatchObject({
      resultado: 'negado',
      motivo: 'setor-nao-permitido',
    });
    // Nunca apagada: a regra desativada continua no banco, com a versão nova.
    expect(
      await ler<{ ativo: number; versao: number }>(
        'SELECT ativo, versao FROM regra_acesso_dispositivo WHERE id = ?',
        [r2.id],
      ),
    ).toMatchObject({ ativo: 0, versao: 2 });
    expect(await recusada(regra({ setor: 999_999_999 }))).toBe('setor-desconhecido');
    expect(await recusada(regra({ terminal: 999_999_999 }))).toBe('terminal-desconhecido');

    const escolhas = await porta.perfisESetores(ctx);
    expect(escolhas.perfis.some((x) => x.id === ids.perfil)).toBe(true);
    expect(escolhas.setores.map((x) => x.id)).toEqual(
      expect.arrayContaining([ids.setorUti, ids.setorRecepcao]),
    );
  });

  it('retirado o crachá, o código volta a ser desconhecido', async () => {
    expect(await cracha(null)).toEqual({ id: m.vinculo });
    const ev = await passar('l0218-retirado');
    expect(ev).toMatchObject({ resultado: 'negado', motivo: 'cracha-desconhecido', colaborador: null });
    expect(await gravado(ev.id)).toMatchObject({ colaborador_id: null, regra_acesso_dispositivo_id: null });
  });
});
