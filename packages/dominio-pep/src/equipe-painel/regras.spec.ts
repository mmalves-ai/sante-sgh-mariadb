import { describe, expect, it } from 'vitest';
import {
  avaliarRetroativo,
  CONFIGURACAO_PRONTUARIO_PADRAO,
  type ConfiguracaoSetor,
  destinatariosDePendencias,
  type FuncaoEquipe,
  type MembroEquipe,
  resolverConfiguracaoProntuario,
  temVinculoPelaEquipe,
  validarAcompanhar,
  validarColunasPainel,
  validarConfiguracaoSetor,
  validarInclusaoMembro,
  validarSaidaMembro,
} from './regras.js';

const codigos = (e: readonly { codigo: string }[]) => e.map((x) => x.codigo);

describe('pacientes acompanhados e colunas do painel', () => {
  it('não marca duas vezes o mesmo paciente vigente; o encerrado pode voltar', () => {
    expect(codigos(validarAcompanhar([{ paciente: 7, fim: null }], 7, null))).toEqual(['ja-acompanhado']);
    expect(validarAcompanhar([{ paciente: 7, fim: '2026-11-20' }], 7, 'pós-operatório')).toEqual([]);
    expect(codigos(validarAcompanhar([], 0, 'x'.repeat(501)))).toEqual(['paciente-invalido', 'motivo-longo']);
  });
  it('colunas: do catálogo, sem repetição e no mínimo duas', () => {
    const cat = ['nome', 'leito', 'idade'];
    expect(validarColunasPainel(['leito', 'nome'], cat)).toEqual([]);
    expect(codigos(validarColunasPainel(['nome'], cat))).toEqual(['colunas-minimas']);
    expect(codigos(validarColunasPainel(['nome', 'nome', 'cpf'], cat))).toEqual([
      'coluna-desconhecida',
      'coluna-repetida',
    ]);
  });
});

describe('configuração do prontuário por setor', () => {
  const base: ConfiguracaoSetor = {
    ...CONFIGURACAO_PRONTUARIO_PADRAO,
    setor: 10,
    tipoAtendimento: 'todos',
    ativo: true,
  };
  it('tolerância só com retroativo, de 1 a 720 h', () => {
    expect(codigos(validarConfiguracaoSetor({ ...base, toleranciaRetroativoHoras: 4 }))).toEqual([
      'tolerancia-sem-retroativo',
    ]);
    expect(
      codigos(validarConfiguracaoSetor({ ...base, permiteRetroativo: true, toleranciaRetroativoHoras: 0 })),
    ).toEqual(['tolerancia-fora']);
    expect(
      validarConfiguracaoSetor({ ...base, permiteRetroativo: true, toleranciaRetroativoHoras: 24 }),
    ).toEqual([]);
  });
  it('o tipo exato vence o "todos" do setor, que vence o padrão; inativa não conta', () => {
    const uti: ConfiguracaoSetor = {
      ...base,
      tipoAtendimento: 'internacao',
      assinaturaExigida: 'digital_icp',
    };
    const linhas = [base, uti, { ...base, setor: 11, ativo: false }];
    expect(resolverConfiguracaoProntuario(linhas, 10, 'internacao').origem).toBe('setor-tipo');
    expect(resolverConfiguracaoProntuario(linhas, 10, 'internacao').configuracao.assinaturaExigida).toBe(
      'digital_icp',
    );
    expect(resolverConfiguracaoProntuario(linhas, 10, 'ambulatorio').origem).toBe('setor');
    expect(resolverConfiguracaoProntuario(linhas, 11, 'ambulatorio').origem).toBe('padrao');
    expect(resolverConfiguracaoProntuario(linhas, null, 'todos').origem).toBe('padrao');
  });
  it('retroativo: até 15 min sempre; depois, só com a regra do setor e dentro da tolerância', () => {
    const agora = new Date('2026-11-24T12:00:00Z');
    const h = (n: number) => new Date(agora.getTime() - n * 3_600_000);
    expect(
      avaliarRetroativo(CONFIGURACAO_PRONTUARIO_PADRAO, new Date(agora.getTime() - 10 * 60_000), agora),
    ).toEqual({ permitido: true, motivo: null });
    expect(avaliarRetroativo(CONFIGURACAO_PRONTUARIO_PADRAO, h(2), agora).permitido).toBe(false);
    const ret = { ...base, permiteRetroativo: true, toleranciaRetroativoHoras: 6 };
    expect(avaliarRetroativo(ret, h(5), agora).permitido).toBe(true);
    expect(avaliarRetroativo(ret, h(7), agora).motivo).toMatch(/6 h/);
    expect(avaliarRetroativo({ ...ret, toleranciaRetroativoHoras: null }, h(100), agora).permitido).toBe(
      true,
    );
  });
});

describe('equipe assistencial', () => {
  const assistente: FuncaoEquipe = { id: 1, categoria: 'medica', responsavelPrincipal: true, ativo: true };
  const enfRef: FuncaoEquipe = { id: 2, categoria: 'enfermagem', responsavelPrincipal: false, ativo: true };
  const m = (
    id: number,
    profissional: number,
    funcao: number,
    o: Partial<MembroEquipe> = {},
  ): MembroEquipe => ({
    id,
    profissional,
    funcao,
    responsavelPrincipal: false,
    recebeNotificacao: false,
    inicio: '2026-11-20T10:00:00',
    fim: null,
    ...o,
  });
  it('um único responsável principal vigente, de função médica, sem repetir profissional na função', () => {
    const atuais = [m(1, 100, 1, { responsavelPrincipal: true })];
    expect(
      codigos(
        validarInclusaoMembro(atuais, { profissional: 101, funcao: assistente, recebeNotificacao: true }),
      ),
    ).toEqual(['responsavel-duplicado']);
    expect(
      validarInclusaoMembro(atuais, { profissional: 102, funcao: enfRef, recebeNotificacao: true }),
    ).toEqual([]);
    expect(
      codigos(
        validarInclusaoMembro(atuais, { profissional: 100, funcao: assistente, recebeNotificacao: false }),
      ),
    ).toContain('membro-repetido');
    const encerrado = [m(1, 100, 1, { responsavelPrincipal: true, fim: '2026-11-21T08:00:00' })];
    expect(
      validarInclusaoMembro(encerrado, { profissional: 101, funcao: assistente, recebeNotificacao: true }),
    ).toEqual([]);
    expect(
      codigos(
        validarInclusaoMembro([], {
          profissional: 1,
          funcao: { ...enfRef, responsavelPrincipal: true, ativo: false },
          recebeNotificacao: false,
        }),
      ),
    ).toEqual(['funcao-inativa', 'responsavel-nao-medico']);
  });
  it('saída com motivo e só de membro vigente', () => {
    expect(validarSaidaMembro(m(1, 1, 1), 'troca de plantão')).toEqual([]);
    expect(codigos(validarSaidaMembro(m(1, 1, 1, { fim: '2026-11-21' }), 'ok'))).toEqual([
      'membro-encerrado',
      'motivo-invalido',
    ]);
    expect(codigos(validarSaidaMembro(undefined, 'qualquer'))).toEqual(['membro-inexistente']);
  });
  it('vínculo e pendências: só a equipe vigente; o responsável principal sempre recebe', () => {
    const eq = [
      m(1, 100, 1, { responsavelPrincipal: true }),
      m(2, 101, 2, { recebeNotificacao: true }),
      m(3, 102, 2),
      m(4, 103, 2, { recebeNotificacao: true, fim: '2026-11-21' }),
    ];
    expect(temVinculoPelaEquipe(eq, 102)).toBe(true);
    expect(temVinculoPelaEquipe(eq, 103)).toBe(false);
    expect(destinatariosDePendencias(eq)).toEqual([100, 101]);
  });
});
