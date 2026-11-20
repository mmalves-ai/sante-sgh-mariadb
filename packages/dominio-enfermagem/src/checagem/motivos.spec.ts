// Regras 6 e 7 do M25: motivo da não administração da lista; "se necessário" com a condição; dupla checagem.
import { describe, expect, it } from 'vitest';
import {
  conferirConferente,
  conferirDesfecho,
  ehMotivoValido,
  exigeDuplaChecagem,
  justificativaDoDesfecho,
} from './motivos.js';

describe('regra 6: não administrado exige o motivo da lista', () => {
  it('os seis motivos da lista', () => {
    for (const m of ['recusa', 'jejum', 'ausente', 'faltaItem', 'intercorrencia', 'suspensaoMedica'])
      expect(ehMotivoValido(m)).toBe(true);
    expect(ehMotivoValido('outro')).toBe(false);
    expect(ehMotivoValido(null)).toBe(false);
  });
  it('sem motivo ou com motivo fora da lista, recusado', () => {
    const n = { desfecho: 'naoAdministrado' as const, observacao: null, seNecessario: false };
    expect(conferirDesfecho({ ...n, motivo: null })).toMatch(/motivo da não administração/);
    expect(conferirDesfecho({ ...n, motivo: 'qualquer' })).toMatch(/motivo/);
    expect(conferirDesfecho({ ...n, motivo: 'jejum' })).toBeNull();
  });
  it('o administrado não leva motivo da lista; o "se necessário" exige a condição', () => {
    const a = { desfecho: 'administrado' as const, motivo: null, observacao: null, seNecessario: false };
    expect(conferirDesfecho(a)).toBeNull();
    expect(conferirDesfecho({ ...a, motivo: 'jejum' })).toMatch(/só da não administração/);
    expect(conferirDesfecho({ ...a, seNecessario: true })).toMatch(/se necessário/);
    expect(conferirDesfecho({ ...a, seNecessario: true, observacao: 'dor 7' })).toBeNull();
  });
  it('a justificativa gravada no horário', () => {
    expect(justificativaDoDesfecho({ desfecho: 'naoAdministrado', motivo: 'jejum', observacao: null })).toBe(
      'Paciente em jejum',
    );
    expect(
      justificativaDoDesfecho({ desfecho: 'naoAdministrado', motivo: 'recusa', observacao: 'nauseado' }),
    ).toBe('Recusa do paciente: nauseado');
    expect(justificativaDoDesfecho({ desfecho: 'administrado', motivo: null, observacao: ' dor 7 ' })).toBe(
      'dor 7',
    );
    expect(justificativaDoDesfecho({ desfecho: 'administrado', motivo: null, observacao: null })).toBeNull();
  });
});

describe('regra 7: dupla checagem', () => {
  it('alta vigilância (com o parâmetro) e hemocomponente (sempre)', () => {
    const b = { altaVigilancia: false, duplaMarcada: false, hemocomponente: false, parametroLigado: true };
    expect(exigeDuplaChecagem(b)).toBe(false);
    expect(exigeDuplaChecagem({ ...b, altaVigilancia: true })).toBe(true);
    expect(exigeDuplaChecagem({ ...b, duplaMarcada: true })).toBe(true);
    expect(exigeDuplaChecagem({ ...b, altaVigilancia: true, parametroLigado: false })).toBe(false);
    expect(exigeDuplaChecagem({ ...b, hemocomponente: true, parametroLigado: false })).toBe(true);
  });
  it('o segundo profissional com login próprio, diferente, senha conferida e a permissão', () => {
    const c = {
      exigida: true,
      primeiro: 'ENF.A',
      conferente: 'ENF.B',
      senhaConferida: true,
      podeConferir: true,
    };
    expect(conferirConferente(c)).toEqual({ ok: true });
    expect(conferirConferente({ ...c, exigida: false, conferente: null })).toEqual({ ok: true });
    expect(conferirConferente({ ...c, conferente: null })).toMatchObject({ codigo: 'conferente-ausente' });
    expect(conferirConferente({ ...c, conferente: ' enf.a ' })).toMatchObject({ codigo: 'conferente-mesmo' });
    expect(conferirConferente({ ...c, senhaConferida: false })).toMatchObject({ codigo: 'conferente-senha' });
    expect(conferirConferente({ ...c, podeConferir: false })).toMatchObject({
      codigo: 'conferente-sem-permissao',
    });
  });
});
