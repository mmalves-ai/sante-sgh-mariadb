// Regras das telas do M27: o filtro da fila do médico, o nível de cada pendência, os destinos sem repetição, a
// validação local da mensagem e do comunicado (regra 7: nenhum dado do paciente no assunto nem no texto) e o filtro
// do dicionário.
import type { LinhaWorklistMedico } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  adicionarDestino,
  anteriorDoEvento,
  motivoValido,
  filtrarFilaMedico,
  filtrarPalavras,
  nivelDaPendencia,
  validarComunicado,
  validarMensagem,
} from './regras-tela.js';

const linha = (
  atendimento: number,
  tipo: LinhaWorklistMedico['tipo'],
  pend: number,
): LinhaWorklistMedico => ({
  paciente: atendimento,
  nome: `PACIENTE ${atendimento}`,
  idade: null,
  sexo: null,
  prontuario: '1',
  atendimento,
  registro: atendimento,
  tipo,
  unidade: null,
  leito: null,
  dias: null,
  previsaoAlta: null,
  alergias: 'nao-avaliadas',
  pendencias: Array.from({ length: pend }, () => ({
    tipo: 'resultado-novo' as const,
    quantidade: 1,
    prazo: null,
    texto: '',
    link: '/x',
  })),
  prioridade: 0,
  prazo: null,
});

describe('fila do médico na tela', () => {
  const ps = [linha(1, 'internacao', 0), linha(2, 'externo', 2), linha(3, 'internacao', 1)];
  it('filtra só com pendência e só internados', () => {
    expect(filtrarFilaMedico(ps, 'todos').map((p) => p.atendimento)).toEqual([1, 2, 3]);
    expect(filtrarFilaMedico(ps, 'pendentes').map((p) => p.atendimento)).toEqual([2, 3]);
    expect(filtrarFilaMedico(ps, 'internados').map((p) => p.atendimento)).toEqual([1, 3]);
  });
  it('o crítico e a falta de evolução são urgentes; prescrição e parecer atrasado, de prazo', () => {
    expect(nivelDaPendencia('critico-nao-visto')).toBe('urgente');
    expect(nivelDaPendencia('sem-evolucao-24h')).toBe('urgente');
    expect(nivelDaPendencia('prescricao-a-renovar')).toBe('prazo');
    expect(nivelDaPendencia('parecer-atrasado')).toBe('prazo');
    expect(nivelDaPendencia('resultado-novo')).toBe('informativa');
  });
});

describe('mensagem na tela (regra 7)', () => {
  const base = {
    assunto: 'Passagem de plantão',
    texto: 'Favor rever a prescrição do leito 12 antes das 14 h.',
    destinos: [{ tipo: 'usuario' as const, valor: 'SINT.MEDICO' }],
    cienciaObrigatoria: false,
    contexto: '',
  };
  it('destinos sem repetição, logins e perfis em maiúsculas', () => {
    let ds = adicionarDestino([], 'usuario', ' sint.medico ');
    ds = adicionarDestino(ds, 'usuario', 'SINT.MEDICO');
    ds = adicionarDestino(ds, 'grupo', 'medicos');
    ds = adicionarDestino(ds, 'setor', '');
    expect(ds).toEqual([
      { tipo: 'usuario', valor: 'SINT.MEDICO' },
      { tipo: 'grupo', valor: 'MEDICOS' },
    ]);
  });
  it('passa sem dado do paciente; o contexto vai como número do atendimento', () => {
    const r = validarMensagem({ ...base, contexto: '1201' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.contextoAtendimento).toBe(1201);
  });
  it('recusa CPF no texto, prontuário no assunto, contexto não numérico e mensagem sem destino', () => {
    const cpf = validarMensagem({ ...base, texto: 'Paciente CPF 123.456.789-09 no leito.' });
    expect(cpf.ok).toBe(false);
    if (!cpf.ok) expect(cpf.erros['texto']).toMatch(/CPF/);
    const pront = validarMensagem({ ...base, assunto: 'Prontuário 123456' });
    expect(pront.ok).toBe(false);
    if (!pront.ok) expect(pront.erros['assunto']).toMatch(/prontuário/);
    const ctx = validarMensagem({ ...base, contexto: 'Maria' });
    expect(ctx.ok).toBe(false);
    if (!ctx.ok) expect(ctx.erros['contextoAtendimento']).toBeTruthy();
    const sem = validarMensagem({ ...base, destinos: [] });
    expect(sem.ok).toBe(false);
    if (!sem.ok) expect(sem.erros['destinos']).toBeTruthy();
  });
  it('comunicado: a vigência com fim depois do início', () => {
    const ok = validarComunicado({
      ...base,
      vigenciaInicio: '2026-10-22T08:00',
      vigenciaFim: '2026-10-29T18:00',
    });
    expect(ok.ok).toBe(true);
    const ruim = validarComunicado({
      ...base,
      vigenciaInicio: '2026-10-29T08:00',
      vigenciaFim: '2026-10-22T18:00',
    });
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(ruim.erros['vigenciaFim']).toBeTruthy();
  });
});

describe('dicionário na tela', () => {
  it('filtra sem acento e sem maiúsculas', () => {
    const ps = [{ palavra: 'Dipirona' }, { palavra: 'Hemácia' }, { palavra: 'eletrocardiograma' }];
    expect(filtrarPalavras(ps, 'hemac').map((p) => p.palavra)).toEqual(['Hemácia']);
    expect(filtrarPalavras(ps, 'DIP').map((p) => p.palavra)).toEqual(['Dipirona']);
    expect(filtrarPalavras(ps, '  ')).toHaveLength(3);
  });
});

describe('ciclo de vida do comunicado na tela (W0-09)', () => {
  it('o motivo tem ao menos 5 caracteres', () => {
    expect(motivoValido('  abc ')).toBe(false);
    expect(motivoValido('texto errado')).toBe(true);
  });
  it('o anterior da correção aparece como assunto e texto; o resto como veio', () => {
    expect(anteriorDoEvento(JSON.stringify({ assunto: 'Escala', texto: 'Plantão dia 3' }))).toBe(
      'Escala: Plantão dia 3',
    );
    expect(anteriorDoEvento('2026-12-01T10:00:00')).toBe('2026-12-01T10:00:00');
    expect(anteriorDoEvento('{"x":1}')).toBe('{"x":1}');
  });
});
