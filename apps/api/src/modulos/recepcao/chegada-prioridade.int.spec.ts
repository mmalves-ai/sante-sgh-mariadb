// 02-AGE linha 49, contrato de efeito: o grupo de prioridade legal escolhido na marcação segue o paciente na senha
// quando a recepção registra a chegada (regra do domínio grupoDaSenhaNaChegada: o mais forte vence, grupo desativado
// não vale). Fica no banco: senha_emitida.grupo_prioridade_legal_id e prioritaria, e o grupo anterior da senha no
// histórico da chegada; desfazer a chegada devolve o grupo anterior. Massa SINTÉTICA da recepção (rc0101a), limpa
// antes e depois; o grupo da marcação volta a vazio no fim. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  CODIGO_EST,
  garantirCliente,
  limparMovimento,
  LOGIN,
  type Massa,
  montarMassa,
  SEM_BANCO,
} from './massa-recepcao.spec-util.js';
import { PortaRecepcaoPropria } from './porta-propria.js';
import type { ContextoGravacao } from './tipos.js';

const c = { rede: 'rede-teste', hospital: CODIGO_EST };
const g = (): ContextoGravacao => {
  const chave = `age49-${randomUUID()}`;
  return { login: LOGIN, correlacao: chave.slice(0, 40), chaveIdempotencia: chave };
};

describe.skipIf(SEM_BANCO)('02-AGE 49: grupo legal da marcação na senha da chegada (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRecepcaoPropria;
  let m: Massa;
  const grupos: Record<string, number> = {};
  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-age49' }, (l) =>
      l.consultar<T & Record<string, unknown>>(sql, p),
    );
  const grupoDaMarcacao = (grupo: number | null) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-age49' }, (e) =>
      e.executar('UPDATE marcacao_horario SET grupo_prioridade_legal_id = ? WHERE id = ?', [
        grupo,
        m.marcacao,
      ]),
    );
  const senhaNoBanco = async (id: number) =>
    (
      await ler<{ grupo_prioridade_legal_id: number | null; prioritaria: number | boolean }>(
        'SELECT grupo_prioridade_legal_id, prioritaria FROM senha_emitida WHERE id = ?',
        [id],
      )
    )[0]!;
  const emitir = async (prioridade: '0' | '2') =>
    Number(
      (
        await porta.executar(
          c,
          'recepcao.emitirSenha',
          { gerador: m.gerador, prioridade, origem: 'balcao' },
          g(),
        )
      ).resultado['senha'],
    );

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaRecepcaoPropria(nucleo, nucleo.criarExecutor(), CLIENTE);
    for (const x of await ler<{ id: number; codigo: string }>(
      "SELECT id, codigo FROM grupo_prioridade_legal WHERE codigo IN ('gestante', 'idoso_80')",
    ))
      grupos[x.codigo] = Number(x.id);
  });
  beforeEach(async () => {
    await limparMovimento(nucleo, m);
  });
  afterAll(async () => {
    if (m) {
      await limparMovimento(nucleo, m);
      await grupoDaMarcacao(null);
    }
    await nucleo?.encerrar();
  });

  it('a senha normal recebe o grupo da marcação na chegada e o devolve ao desfazer', async () => {
    await grupoDaMarcacao(grupos['gestante']!);
    const senha = await emitir('2');
    expect(await senhaNoBanco(senha)).toMatchObject({ grupo_prioridade_legal_id: null });
    await porta.executar(
      c,
      'recepcao.registrarChegada',
      { senha, tipo: 'consulta', marcacao: m.marcacao },
      g(),
    );
    const depois = await senhaNoBanco(senha);
    expect(Number(depois.grupo_prioridade_legal_id)).toBe(grupos['gestante']);
    expect(Boolean(depois.prioritaria)).toBe(true);
    const h = await ler<{ dados: string }>(
      "SELECT dados FROM marcacao_horario_historico WHERE marcacao_horario_id = ? AND evento = 'chegada'",
      [m.marcacao],
    );
    const d = (typeof h[0]!.dados === 'string' ? JSON.parse(h[0]!.dados) : h[0]!.dados) as Record<
      string,
      unknown
    >;
    expect(d).toMatchObject({ senha_grupo_anterior_id: null, senha_grupo_aplicado_id: grupos['gestante'] });
    await porta.executar(
      c,
      'recepcao.desfazerChegada',
      { senha, motivo: 'Chegada por engano no teste age49' },
      g(),
    );
    const volta = await senhaNoBanco(senha);
    expect(volta.grupo_prioridade_legal_id).toBeNull();
    expect(Boolean(volta.prioritaria)).toBe(false);
  });

  it('a senha mais forte (acima de 80 anos) fica com o seu grupo; marcação sem grupo não muda a senha', async () => {
    await grupoDaMarcacao(grupos['gestante']!);
    const forte = await emitir('0');
    await porta.executar(
      c,
      'recepcao.registrarChegada',
      { senha: forte, tipo: 'consulta', marcacao: m.marcacao },
      g(),
    );
    expect(Number((await senhaNoBanco(forte)).grupo_prioridade_legal_id)).toBe(grupos['idoso_80']);
    await limparMovimento(nucleo, m);
    await grupoDaMarcacao(null);
    const normal = await emitir('2');
    await porta.executar(
      c,
      'recepcao.registrarChegada',
      { senha: normal, tipo: 'consulta', marcacao: m.marcacao },
      g(),
    );
    const s = await senhaNoBanco(normal);
    expect(s.grupo_prioridade_legal_id).toBeNull();
    expect(Boolean(s.prioritaria)).toBe(false);
  });
});
