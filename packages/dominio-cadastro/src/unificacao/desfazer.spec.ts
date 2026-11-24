import { describe, expect, it } from 'vitest';
import {
  conferirRegistroDevolvido,
  planoDeDesfazer,
  RECUSA_REGISTRO_ALTERADO,
  type ItemTransferido,
} from './desfazer.js';

const U = { situacao: 'efetivada', reversivel: true, mantido: 10, absorvido: 20 };
const item = (sequencia: number, situacao = 'transferido'): ItemTransferido => ({
  id: sequencia,
  sequencia,
  tabela: 'atendimento',
  registroId: 100 + sequencia,
  coluna: 'paciente_id',
  situacao,
  versaoRegistro: 2,
});

describe('desfazer a unificação de prontuários', () => {
  it('devolve os itens transferidos do último ao primeiro', () => {
    const p = planoDeDesfazer(U, [item(1), item(3), item(2), item(4, 'revertido')], 'Pessoas diferentes');
    expect(p.ok && p.devolver.map((i) => i.sequencia)).toEqual([3, 2, 1]);
  });

  it('exige motivo de 5 a 400 letras', () => {
    expect(planoDeDesfazer(U, [], '  abc ')).toMatchObject({
      ok: false,
      recusa: { codigo: 'motivo-obrigatorio' },
    });
    expect(planoDeDesfazer(U, [], 'x'.repeat(401))).toMatchObject({ ok: false });
  });

  it('recusa a já revertida, a não efetivada e a não reversível', () => {
    expect(planoDeDesfazer({ ...U, situacao: 'revertida' }, [], 'Motivo bom')).toMatchObject({
      recusa: { codigo: 'ja-revertida' },
    });
    expect(planoDeDesfazer({ ...U, situacao: 'falhou' }, [], 'Motivo bom')).toMatchObject({
      recusa: { codigo: 'unificacao-nao-efetivada' },
    });
    expect(planoDeDesfazer({ ...U, reversivel: false }, [], 'Motivo bom')).toMatchObject({
      recusa: { codigo: 'unificacao-irreversivel' },
    });
  });

  it('recusa o registro que sumiu ou que já aponta para outro cadastro', () => {
    expect(conferirRegistroDevolvido(item(1), { apontaPara: 10, versao: 2 }, 10)).toBeNull();
    expect(conferirRegistroDevolvido(item(1), null, 10)?.codigo).toBe('desfazer-registro-inexistente');
    expect(conferirRegistroDevolvido(item(1), { apontaPara: 30, versao: 2 }, 10)?.codigo).toBe(
      'desfazer-conflito',
    );
  });

  it('recusa o registro alterado depois da unificação (versão diferente da gravada no item)', () => {
    const r = conferirRegistroDevolvido(item(1), { apontaPara: 10, versao: 3 }, 10);
    expect(r?.codigo).toBe(RECUSA_REGISTRO_ALTERADO);
    expect(r?.mensagem).toContain('não reversível');
    // Item antigo, sem a versão gravada: só o ponteiro é conferido.
    expect(
      conferirRegistroDevolvido({ ...item(1), versaoRegistro: null }, { apontaPara: 10, versao: 9 }, 10),
    ).toBeNull();
  });
});
