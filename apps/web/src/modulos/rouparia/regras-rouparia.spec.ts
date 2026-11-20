// Regras de tela da rouparia (M55, fatia F2): o corpo do pedido só com os campos do tipo, a conferência antes de gravar,
// a prévia do retorno, as cotas que mudaram e a formatação.
import type { CotaRoupa, PecaRoupa } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  camposDoTipo,
  composicaoDasLinhas,
  cotasAlteradas,
  dataCurta,
  fmtKg,
  fmtReais,
  formVazio,
  instanteCurto,
  itensDasLinhas,
  itensTexto,
  menosDias,
  montarMovimento,
  nomeDe,
  numeroDoTexto,
  podeCancelar,
  previaRetorno,
} from './regras-rouparia.js';

const peca = (id: number, nome: string, ativa = true): PecaRoupa => ({
  id,
  nome,
  categoria: 'lencol',
  pesoGramas: 600,
  custoReposicaoCentavos: null,
  composicao: [],
  ativa,
  versao: 1,
});
const ctx = {
  hoje: '2026-10-28',
  pecas: [peca(1, 'Lençol'), peca(2, 'Fronha'), peca(3, 'Velha', false)],
  setores: [
    { codigo: 10, ativo: true },
    { codigo: 11, ativo: false },
  ],
};
const CHAVE = 'm55r.teste.0001';

describe('numeroDoTexto', () => {
  it('aceita vírgula, ponto, milhar e número', () => {
    expect(numeroDoTexto('12,5')).toBe(12.5);
    expect(numeroDoTexto('12.5')).toBe(12.5);
    expect(numeroDoTexto('1.234,567')).toBe(1234.567);
    expect(numeroDoTexto(7)).toBe(7);
    expect(numeroDoTexto('')).toBeNull();
    expect(numeroDoTexto('abc')).toBeNull();
    expect(numeroDoTexto(null)).toBeNull();
    expect(numeroDoTexto(Number.NaN)).toBeNull();
  });
});

describe('linhas de peças', () => {
  it('só as linhas completas viram itens; quantidade inteira', () => {
    expect(
      itensDasLinhas([
        { peca: 1, quantidade: '10' },
        { peca: null, quantidade: '' },
        { peca: 2, quantidade: '' },
        { peca: 2, quantidade: 3.7 },
      ]),
    ).toEqual([
      { peca: 1, quantidade: 10 },
      { peca: 2, quantidade: 3 },
    ]);
  });
  it('a composição do kit deixa de fora a quantidade zero', () => {
    expect(
      composicaoDasLinhas([
        { peca: 1, quantidade: 2 },
        { peca: 2, quantidade: 0 },
      ]),
    ).toEqual([{ peca: 1, quantidade: 2 }]);
  });
});

describe('camposDoTipo', () => {
  it('envio e retorno são da rouparia central; perda pede motivo', () => {
    expect(camposDoTipo('coleta')).toMatchObject({
      setor: true,
      setorObrigatorio: true,
      pesoObrigatorio: true,
    });
    expect(camposDoTipo('envio')).toMatchObject({ setor: false, lavanderia: true });
    expect(camposDoTipo('retorno')).toMatchObject({ setor: false, remessa: true });
    expect(camposDoTipo('entrega')).toMatchObject({ pecasObrigatorias: true, pesoObrigatorio: false });
    expect(camposDoTipo('perda')).toMatchObject({ motivo: true, setorObrigatorio: false });
  });
});

describe('montarMovimento', () => {
  it('coleta pesada no setor: o corpo sai só com o que o tipo aceita', () => {
    const f = {
      ...formVazio('coleta', '2026-10-28'),
      centroCusto: 10,
      peso: '12,5',
      remessa: 99,
      lavanderia: 'propria' as const,
    };
    const r = montarMovimento(f, CHAVE, ctx);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.corpo).toMatchObject({
        chave: CHAVE,
        tipo: 'coleta',
        centroCusto: 10,
        pesoKg: 12.5,
        remessa: null,
        lavanderia: null,
        itens: [],
      });
  });
  it('sem data usa o hoje do estabelecimento', () => {
    const r = montarMovimento({ ...formVazio('coleta'), centroCusto: 10, peso: '3' }, CHAVE, ctx);
    expect(r.ok && r.corpo.data).toBe('2026-10-28');
  });
  it('recusa com o texto do servidor: setor, peso, setor inativo, peça inativa', () => {
    const sem = montarMovimento(formVazio('coleta', '2026-10-28'), CHAVE, ctx);
    expect(sem.ok).toBe(false);
    if (!sem.ok) {
      expect(sem.mensagens).toContain('Escolha o setor do movimento.');
      expect(sem.mensagens).toContain('Informe o peso, em quilos.');
    }
    const inativo = montarMovimento(
      { ...formVazio('coleta', '2026-10-28'), centroCusto: 11, peso: '2' },
      CHAVE,
      ctx,
    );
    expect(!inativo.ok && inativo.mensagens).toContain('O setor escolhido não existe ou está inativo.');
    const velha = montarMovimento(
      { ...formVazio('entrega', '2026-10-28'), centroCusto: 10, linhas: [{ peca: 3, quantidade: '2' }] },
      CHAVE,
      ctx,
    );
    expect(!velha.ok && velha.mensagens[0]).toMatch(/enxoval/);
  });
  it('peso inválido e data futura', () => {
    const p = montarMovimento(
      { ...formVazio('coleta', '2026-10-28'), centroCusto: 10, peso: '1,2,3' },
      CHAVE,
      ctx,
    );
    expect(!p.ok && p.mensagens[0]).toMatch(/Peso inválido/);
    const futura = montarMovimento(
      { ...formVazio('coleta', '2026-10-29'), centroCusto: 10, peso: '1' },
      CHAVE,
      ctx,
    );
    expect(!futura.ok && futura.mensagens).toContain('A data do movimento não pode ser futura.');
  });
  it('envio terceirizado pede o fornecedor; o setor some', () => {
    const f = {
      ...formVazio('envio', '2026-10-28'),
      peso: '40',
      lavanderia: 'terceirizada' as const,
      centroCusto: 10,
    };
    const r = montarMovimento(f, CHAVE, ctx);
    expect(!r.ok && r.mensagens).toContain('A lavanderia terceirizada pede o fornecedor.');
    const ok = montarMovimento({ ...f, fornecedor: 77 }, CHAVE, ctx);
    expect(ok.ok && ok.corpo).toMatchObject({
      centroCusto: null,
      fornecedor: 77,
      lavanderia: 'terceirizada',
    });
  });
  it('retorno confere o envio: já retornado ou antes do envio', () => {
    const f = { ...formVazio('retorno', '2026-10-28'), peso: '38', remessa: 5 };
    const ja = montarMovimento(f, CHAVE, {
      ...ctx,
      remessa: { tipo: 'envio', situacao: 'retornado', data: '2026-10-27' },
    });
    expect(!ja.ok && ja.mensagens).toContain('Este envio já tem o retorno registrado.');
    const antes = montarMovimento({ ...f, data: '2026-10-26' }, CHAVE, {
      ...ctx,
      remessa: { tipo: 'envio', situacao: 'registrado', data: '2026-10-27' },
    });
    expect(!antes.ok && antes.mensagens).toContain('O retorno não pode ter data anterior à do envio.');
    const ok = montarMovimento(f, CHAVE, {
      ...ctx,
      remessa: { tipo: 'envio', situacao: 'registrado', data: '2026-10-27' },
    });
    expect(ok.ok && ok.corpo.remessa).toBe(5);
  });
  it('perda pede o motivo', () => {
    const r = montarMovimento(
      { ...formVazio('perda', '2026-10-28'), linhas: [{ peca: 1, quantidade: '2' }] },
      CHAVE,
      ctx,
    );
    expect(!r.ok && r.mensagens).toContain('Informe o motivo da perda.');
  });
});

describe('previaRetorno', () => {
  const envio = { pesoKg: 40, itens: [{ peca: 1, quantidade: 20 }] };
  it('sem envio ou sem peso não há prévia', () => {
    expect(previaRetorno(null, { peso: '38', linhas: [] }, 5)).toBeNull();
    expect(previaRetorno(envio, { peso: '', linhas: [] }, 5)).toBeNull();
  });
  it('diferença acima da tolerância e peça faltando viram ocorrência', () => {
    const p = previaRetorno(envio, { peso: '37', linhas: [{ peca: 1, quantidade: '18' }] }, 5)!;
    expect(p.diferencaKg).toBe(3);
    expect(p.diferencaPct).toBe(7.5);
    expect(p.ocorrencia).toBe(true);
    expect(p.pecasFaltando).toEqual([{ peca: 1, enviadas: 20, retornadas: 18, faltam: 2 }]);
  });
  it('dentro da tolerância, sem ocorrência', () => {
    expect(previaRetorno(envio, { peso: '39', linhas: [] }, 5)!.ocorrencia).toBe(false);
  });
});

describe('cotasAlteradas', () => {
  const atuais: CotaRoupa[] = [
    { centroCusto: 10, peca: 1, quantidade: 30, versao: 1 },
    { centroCusto: 12, peca: 2, quantidade: 5, versao: 1 },
  ];
  it('só as que mudaram; vazio conta como zero (tira a cota)', () => {
    expect(cotasAlteradas(10, { 1: '30', 2: 8 }, atuais)).toEqual([{ peca: 2, quantidade: 8 }]);
    expect(cotasAlteradas(10, { 1: '', 2: '' }, atuais)).toEqual([{ peca: 1, quantidade: 0 }]);
  });
  it('recusa número negativo, fracionário ou grande', () => {
    expect(cotasAlteradas(10, { 1: '-1' }, atuais)).toHaveProperty('erro');
    expect(cotasAlteradas(10, { 1: '2,5' }, atuais)).toHaveProperty('erro');
    expect(cotasAlteradas(10, { 1: 10000 }, atuais)).toHaveProperty('erro');
  });
});

describe('formatação e cancelamento', () => {
  it('kg, reais, datas e nomes', () => {
    expect(fmtKg(12.3456)).toBe('12,346 kg');
    expect(fmtKg(null)).toBe('—');
    expect(fmtReais(12345)).toMatch(/123,45/);
    expect(fmtReais(null)).toBe('—');
    expect(dataCurta('2026-10-28')).toBe('28/10/2026');
    expect(instanteCurto('2026-10-28T14:05:00')).toBe('28/10 14:05');
    expect(menosDias('2026-10-01', 1)).toBe('2026-09-30');
    expect(nomeDe(ctx.pecas, (p) => p.id, 2)).toBe('Fronha');
    expect(nomeDe(ctx.pecas, (p) => p.id, 9)).toBe('#9');
    expect(nomeDe(ctx.pecas, (p) => p.id, null)).toBe('—');
    expect(itensTexto([{ peca: 1, quantidade: 3 }], ctx.pecas)).toBe('Lençol × 3');
    expect(itensTexto([], ctx.pecas)).toBe('—');
  });
  it('cancelar só no prazo; o envio com retorno e o cancelado não', () => {
    const agora = '2026-10-28T12:00:00';
    expect(
      podeCancelar({ situacao: 'registrado', tipo: 'coleta', em: '2026-10-28T08:00:00' }, agora, 24),
    ).toBe(true);
    expect(
      podeCancelar({ situacao: 'registrado', tipo: 'coleta', em: '2026-10-26T08:00:00' }, agora, 24),
    ).toBe(false);
    expect(podeCancelar({ situacao: 'retornado', tipo: 'envio', em: '2026-10-28T08:00:00' }, agora, 24)).toBe(
      false,
    );
    expect(
      podeCancelar({ situacao: 'cancelado', tipo: 'coleta', em: '2026-10-28T08:00:00' }, agora, 24),
    ).toBe(false);
  });
});
