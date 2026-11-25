import { describe, expect, it } from 'vitest';
import {
  type EntradaProvisorio,
  errosCancelamento,
  errosPrazo,
  errosProvisorio,
  errosRegularizacao,
  errosUso,
  estadoDoPrazo,
  normalizarNumeroConselho,
  prazoSugerido,
} from './provisorio.js';

const HOJE = '2041-03-10';
const base = (p: Partial<EntradaProvisorio> = {}): EntradaProvisorio => ({
  nome: 'Profissional Sintetico',
  cpf: null,
  conselhoId: 1,
  numeroConselho: '12345',
  ufConselhoId: 31,
  motivo: 'Plantão coberto antes do cadastro',
  dataInicio: HOJE,
  prazo: prazoSugerido(HOJE),
  ...p,
});

describe('profissional provisório (02-CAD linha 21)', () => {
  it('aceita o cadastro mínimo e sugere 15 dias de prazo', () => {
    expect(errosProvisorio(base(), HOJE)).toEqual([]);
    expect(prazoSugerido(HOJE)).toBe('2041-03-25');
  });

  it('exige conselho, número e UF (a UF só quando o conselho inscreve por região) e motivo', () => {
    expect(
      errosProvisorio(
        base({ conselhoId: null, numeroConselho: ' ', ufConselhoId: null, motivo: 'curto' }),
        HOJE,
      ),
    ).toEqual(['conselho-ausente', 'numero-conselho-ausente', 'uf-conselho-ausente', 'motivo-curto']);
    expect(errosProvisorio(base({ ufConselhoId: null }), HOJE, false)).toEqual([]);
  });

  it('recusa nome sem sobrenome, CPF inválido, início futuro ou antigo demais', () => {
    expect(errosProvisorio(base({ nome: 'Fulano' }), HOJE)).toEqual(['nome-incompleto']);
    expect(errosProvisorio(base({ cpf: '11111111111' }), HOJE)).toEqual(['cpf-invalido']);
    expect(errosProvisorio(base({ cpf: '529.982.247-25' }), HOJE)).toEqual([]);
    expect(errosProvisorio(base({ dataInicio: '2041-03-11', prazo: '2041-03-20' }), HOJE)).toEqual([
      'inicio-futuro',
    ]);
    expect(errosProvisorio(base({ dataInicio: '2041-01-01', prazo: '2041-01-10' }), HOJE)).toEqual([
      'inicio-antigo',
    ]);
  });

  it('prazo curto: no máximo 90 dias; a prorrogação só vai para frente', () => {
    expect(errosPrazo(HOJE, '2041-03-09', null)).toEqual(['prazo-antes-do-inicio']);
    expect(errosPrazo(HOJE, '2041-06-09', null)).toEqual(['prazo-longo']);
    expect(errosPrazo(HOJE, '2041-06-08', null)).toEqual([]);
    expect(errosPrazo(HOJE, '2041-03-20', '2041-03-25')).toEqual(['prazo-nao-prorroga']);
    expect(errosPrazo(HOJE, '2041-02-30', null)).toEqual(['prazo-invalido']);
  });

  it('o vencido é alerta, nunca trava: aceita registro ligado', () => {
    expect(estadoDoPrazo('provisorio', '2041-03-20', HOJE)).toEqual({ estado: 'em_dia', dias: 10 });
    expect(estadoDoPrazo('provisorio', '2041-03-12', HOJE).estado).toBe('vence_logo');
    expect(estadoDoPrazo('provisorio', '2041-03-09', HOJE)).toEqual({ estado: 'vencido', dias: -1 });
    expect(estadoDoPrazo('regularizado', '2041-03-09', HOJE).estado).toBe('encerrado');
    expect(errosUso('expirado', 'atendimento')).toEqual([]);
    expect(errosUso('regularizado', 'atendimento')).toEqual(['provisorio-encerrado']);
    expect(errosUso('provisorio', 'laudo')).toEqual(['tipo-uso-invalido']);
  });

  it('regulariza só com o definitivo ativo, mesmo CPF e a mesma inscrição ativa', () => {
    const p = {
      situacao: 'provisorio' as const,
      cpf: '52998224725',
      conselhoId: 1,
      numeroConselho: '0012345',
      ufConselhoId: 31,
    };
    const d = {
      situacao: 'ativo',
      cpf: '52998224725',
      inscricoes: [{ conselhoId: 1, ufId: 31, numero: '12.345', ativa: true }],
    };
    expect(normalizarNumeroConselho('0012.345-a')).toBe('12345A');
    expect(errosRegularizacao(p, d)).toEqual([]);
    expect(errosRegularizacao(p, { ...d, situacao: 'inativo', cpf: '11144477735' })).toEqual([
      'definitivo-inativo',
      'cpf-diferente',
    ]);
    expect(
      errosRegularizacao(p, {
        ...d,
        inscricoes: [{ conselhoId: 1, ufId: 35, numero: '12345', ativa: true }],
      }),
    ).toEqual(['inscricao-diferente']);
    expect(
      errosRegularizacao(p, {
        ...d,
        inscricoes: [{ conselhoId: 1, ufId: 31, numero: '12345', ativa: false }],
      }),
    ).toEqual(['inscricao-diferente']);
    expect(errosRegularizacao({ ...p, situacao: 'cancelado' }, d)).toEqual(['provisorio-encerrado']);
  });

  it('cancela só sem registro pendente e com motivo', () => {
    expect(errosCancelamento('provisorio', 0, 'Cadastrado por engano')).toEqual([]);
    expect(errosCancelamento('provisorio', 2, 'curto')).toEqual(['usos-pendentes', 'motivo-curto']);
    expect(errosCancelamento('regularizado', 0, 'Cadastrado por engano')).toEqual(['provisorio-encerrado']);
  });
});
