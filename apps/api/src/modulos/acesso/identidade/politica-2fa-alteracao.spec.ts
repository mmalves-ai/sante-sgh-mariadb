// W0-09 (programa CRUD completo), parte 4b: alterar o prazo e o alvo da linha VIGENTE da política do segundo fator,
// com motivo. Parâmetro no banco com o anterior visível: a linha atual fica encerrada ("Alterada: <motivo>") e nasce
// outra com a mesma onda e o mesmo início. Porta em memória, usuários sintéticos.
import { describe, expect, it } from 'vitest';
import { PortaIdentidadeMemoria } from './porta-identidade-memoria.js';
import { type AtorIdentidade, ServicoIdentidade } from './servico-identidade.js';

const INICIO = Date.parse('2026-11-03T13:00:00Z');

function montar() {
  const agora = INICIO;
  const porta = new PortaIdentidadeMemoria(() => agora);
  porta.usuario({ login: 'SINT.GESTOR', id: 72 });
  const s = new ServicoIdentidade({
    porta,
    contingencia: async () => true,
    chave: Buffer.alloc(32, 7),
    emissor: 'Produto sintético',
    argon2: { memoria: 8_192, passes: 1, paralelismo: 1 },
    agora: () => agora,
    aviso: () => undefined,
  });
  return { s, porta };
}
const g: AtorIdentidade = {
  rede: 'rede-teste',
  hospital: 'pc',
  login: 'SINT.GESTOR',
  idUsuario: 72,
  estacao: 'ESTACAO:teste',
  correlacao: 'c-1',
};

describe('W0-09: política do segundo fator — alterar o prazo e o alvo da linha vigente', () => {
  it('encerra a anterior como "Alterada", nasce a nova com a mesma onda e início; recusas', async () => {
    const m = montar();
    const a = await m.s.incluirPolitica(g, {
      alvo: 'perfil',
      valor: 'auditor',
      onda: 1,
      inicio: '2026-11-10',
      prazoAdesaoDias: 7,
      motivo: 'onda 1 dos críticos',
    });
    const b = await m.s.incluirPolitica(g, {
      alvo: 'grupo',
      valor: 'FATURAMENTO',
      onda: 1,
      inicio: '2026-11-10',
      prazoAdesaoDias: 7,
      motivo: 'grupo do faturamento',
    });
    // Nada mudou, alvo já ocupado por outra linha ativa, 'todos' fora da onda 2: recusados (nada grava).
    await expect(
      m.s.alterarPolitica(g, a.id, { alvo: 'perfil', valor: 'auditor', prazoAdesaoDias: 7, motivo: 'igual' }),
    ).rejects.toMatchObject({ codigo: 'politica-invalida' });
    await expect(
      m.s.alterarPolitica(g, a.id, {
        alvo: 'grupo',
        valor: 'FATURAMENTO',
        prazoAdesaoDias: 7,
        motivo: 'dup',
      }),
    ).rejects.toMatchObject({ codigo: 'politica-invalida' });
    await expect(
      m.s.alterarPolitica(g, a.id, { alvo: 'todos', valor: null, prazoAdesaoDias: 7, motivo: 'todos já' }),
    ).rejects.toMatchObject({ codigo: 'politica-invalida' });
    expect(m.porta.trilha).toHaveLength(2);

    const nova = await m.s.alterarPolitica(g, a.id, {
      alvo: 'perfil',
      valor: 'gestor-acessos',
      prazoAdesaoDias: 21,
      motivo: 'prazo maior a pedido da área',
    });
    expect(nova).toMatchObject({
      alvo: 'perfil',
      valor: 'gestor-acessos',
      onda: 1,
      inicio: '2026-11-10',
      prazoAdesaoDias: 21,
      ativa: true,
    });
    expect(nova.id).not.toBe(a.id);
    expect(ServicoIdentidade.fimDaAdesao(nova)).toBe('2026-11-30');
    const todas = await m.s.politicas('pc');
    // A anterior continua visível, encerrada; a outra linha não muda.
    expect(todas.find((p) => p.id === a.id)).toMatchObject({
      ativa: false,
      valor: 'auditor',
      prazoAdesaoDias: 7,
    });
    expect(todas.find((p) => p.id === b.id)).toMatchObject({ ativa: true });
    expect(m.porta.linhas.find((l) => l.id === a.id)).toBeDefined();
    expect(m.porta.trilha.slice(2).map((t) => t.evento)).toEqual([
      'acesso.politicaSegundoFator.alterada',
      'acesso.politicaSegundoFator.alterada',
    ]);
    // A encerrada (ou inexistente) não se altera.
    await expect(
      m.s.alterarPolitica(g, a.id, {
        alvo: 'perfil',
        valor: 'auditor',
        prazoAdesaoDias: 5,
        motivo: 'de novo',
      }),
    ).rejects.toMatchObject({ codigo: 'politica-inexistente' });
    await expect(
      m.s.alterarPolitica(g, '999', {
        alvo: 'perfil',
        valor: 'auditor',
        prazoAdesaoDias: 5,
        motivo: 'nenhuma',
      }),
    ).rejects.toMatchObject({ codigo: 'politica-inexistente' });
  });
});
