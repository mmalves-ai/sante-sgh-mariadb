// 03-PEP L108 (C2-104): a porta em memória das restrições da prescrição segue as regras da porta própria (dados
// SINTÉTICOS).
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { CadastroRestricoesPrescricaoMemoria } from './prescricao-restricoes-memoria.js';

const C = { hospital: 'H1', login: 'SINT.FARMACIA', correlacao: 'c1', chaveIdempotencia: 'k1' };

describe('CadastroRestricoesPrescricaoMemoria', () => {
  it('recusa a faixa invertida e a redução sem limite; grava, altera com a versão e trilha', async () => {
    const trilha = new RegistradorTrilhaMemoria();
    const p = new CadastroRestricoesPrescricaoMemoria(trilha);
    const base = { principio: 11, criterio: 'depuracao_creatinina', ajuste: 'reduzir_dose' };
    await expect(p.gravarAjusteRenal(C, { ...base, faixaMinima: 40, faixaMaxima: 30 })).rejects.toMatchObject(
      { problema: { status: 422 } },
    );
    const g = await p.gravarAjusteRenal(C, { ...base, faixaMinima: 10, faixaMaxima: 30, percentualDose: 50 });
    expect(g).toEqual({ id: 1, versao: 1 });
    await expect(
      p.gravarAjusteRenal(C, { ...base, id: 1, versao: 9, faixaMinima: 10, percentualDose: 50 }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    expect(
      await p.gravarAjusteRenal(C, {
        ...base,
        id: 1,
        versao: 1,
        faixaMinima: 10,
        percentualDose: 50,
        ativo: false,
      }),
    ).toEqual({ id: 1, versao: 2 });
    const cad = await p.cadastro(C);
    expect(cad.ajustes).toHaveLength(1);
    expect(cad.ajustes[0]).toMatchObject({ alvoNome: 'DIPIRONA', ativo: false });
    expect(trilha.eventos.filter((e) => e.evento === 'pep.regraAlerta.alterada')).toHaveLength(2);
  });

  it('restrição pede a mensagem e o alvo existente; configuração repetida no escopo é recusada', async () => {
    const p = new CadastroRestricoesPrescricaoMemoria();
    const r = { principio: 11, tipo: 'contraindicacao', idadeMaximaDias: 28 };
    await expect(p.gravarRestricao(C, { ...r, mensagem: '' })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(p.gravarRestricao(C, { ...r, principio: 999, mensagem: 'x' })).rejects.toMatchObject({
      problema: { status: 404 },
    });
    await p.gravarRestricao(C, { ...r, mensagem: 'Não usar em recém-nascido' });
    await p.gravarConfiguracao(C, { regra: 1, comportamento: 'bloqueio' });
    await expect(p.gravarConfiguracao(C, { regra: 1 })).rejects.toMatchObject({ problema: { status: 409 } });
    const outro = await p.cadastro({ hospital: 'H2', login: 'X' });
    expect(outro.restricoes).toHaveLength(0);
    expect((await p.cadastro(C)).configuracoes[0]).toMatchObject({ regraCodigo: 'DOSE_MAXIMA' });
  });
});
