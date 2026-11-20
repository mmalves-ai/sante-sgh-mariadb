import { urnProblema } from '@sgh/contratos';
import axe from 'axe-core';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { montar } from '../testes/montar.js';
import type { PedidoGravacao, TestidsGravacao } from './dialogo-gravacao.js';
import SanteDialogoGravacao from './SanteDialogoGravacao.vue';

// Dados SINTÉTICOS. O erro imita o da casca (status + problem details), sem a classe do app.
const erroApi = (tipo: string | null, status: number, detail?: string) =>
  Object.assign(new Error('x'), {
    status,
    problema: tipo ? { type: urnProblema(tipo as never), title: 'Problema', status, detail } : null,
  });

function abrir(pedido: PedidoGravacao, testids?: Partial<TestidsGravacao>) {
  const visivel = ref(true);
  const ocupado = ref(false);
  const feito = vi.fn();
  const falha = vi.fn();
  const Pai = defineComponent({
    setup: () => () =>
      h(SanteDialogoGravacao, {
        visivel: visivel.value,
        'onUpdate:visivel': (v: boolean) => (visivel.value = v),
        ocupado: ocupado.value,
        'onUpdate:ocupado': (v: boolean) => (ocupado.value = v),
        pedido,
        ...(testids ? { testids } : {}),
        onFeito: feito,
        onFalha: falha,
      }),
  });
  const w = montar(Pai);
  return { w, visivel, ocupado, feito, falha };
}
const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
function digitar(sel: string, valor: string): void {
  const el = q<HTMLInputElement>(sel)!;
  el.value = valor;
  el.dispatchEvent(new Event('input'));
}
const enviar = (sel = '[data-testid="form-gravacao"]') =>
  q<HTMLFormElement>(sel)!.dispatchEvent(new Event('submit'));

describe('SanteDialogoGravacao: diálogo de gravação único (X-01)', () => {
  it('motivo com menos de 10 letras não confirma (botão desligado e nada gravado)', async () => {
    const gravar = vi.fn(async () => undefined);
    const { w } = abrir({ titulo: 'Inativar', motivo: 'Motivo', senha: false, confirmar: 'Ok', gravar });
    await flushPromises();
    digitar('[data-testid="dialogo-motivo"]', 'curto');
    await flushPromises();
    const b = q<HTMLButtonElement>('[data-testid="dialogo-confirmar"]')!;
    expect(b.disabled || b.getAttribute('aria-disabled') === 'true').toBe(true);
    enviar();
    await flushPromises();
    expect(gravar).not.toHaveBeenCalled();
    w.unmount();
  });

  it('sucesso: grava motivo (aparado) e senha, fecha e emite feito; ocupado volta a falso', async () => {
    const gravar = vi.fn(async () => undefined);
    const { w, visivel, ocupado, feito, falha } = abrir({
      titulo: 'Excluir',
      motivo: 'Motivo',
      senha: true,
      confirmar: 'Excluir',
      gravar,
    });
    await flushPromises();
    digitar('[data-testid="dialogo-motivo"]', '  Cadastro feito por engano  ');
    digitar('[data-testid="dialogo-senha"]', 'sintetica');
    await flushPromises();
    enviar();
    await flushPromises();
    expect(gravar).toHaveBeenCalledWith({ motivo: 'Cadastro feito por engano', senha: 'sintetica' });
    expect(visivel.value).toBe(false);
    expect(ocupado.value).toBe(false);
    expect(feito).toHaveBeenCalledTimes(1);
    expect(falha).not.toHaveBeenCalled();
    w.unmount();
  });

  it('senha que não confere: fica aberto, a senha limpa, o aviso aparece e o motivo fica', async () => {
    const gravar = vi.fn(async () => {
      throw erroApi('reautenticacao-necessaria', 401);
    });
    const { w, visivel, feito, falha } = abrir({
      titulo: 'Excluir',
      motivo: 'Motivo',
      senha: true,
      confirmar: 'Excluir',
      gravar,
    });
    await flushPromises();
    digitar('[data-testid="dialogo-motivo"]', 'Cadastro feito por engano no teste');
    digitar('[data-testid="dialogo-senha"]', 'errada');
    await flushPromises();
    enviar();
    await flushPromises();
    expect(visivel.value).toBe(true);
    expect(feito).not.toHaveBeenCalled();
    expect(falha).not.toHaveBeenCalled();
    expect(q('[data-testid="dialogo-senha-erro"]')?.textContent).toMatch(/senha não confere/);
    expect(q<HTMLInputElement>('[data-testid="dialogo-senha"]')!.value).toBe('');
    expect(q<HTMLTextAreaElement>('[data-testid="dialogo-motivo"]')!.value).toBe(
      'Cadastro feito por engano no teste',
    );
    w.unmount();
  });

  it('tentativas demais mostram o texto do servidor; recusa de negócio fecha e emite falha', async () => {
    let erro: unknown = erroApi('muitas-tentativas', 429, 'Aguarde 5 minutos.');
    const gravar = vi.fn(async () => {
      throw erro;
    });
    const { w, visivel, falha } = abrir(
      { titulo: 'Bloquear', senha: true, confirmar: 'Bloquear', gravar },
      { form: 'form-x', senha: 'senha-x', erro: 'erro-x' },
    );
    await flushPromises();
    digitar('[data-testid="senha-x"]', 'sintetica');
    await flushPromises();
    enviar('[data-testid="form-x"]');
    await flushPromises();
    expect(q('[data-testid="erro-x"]')?.textContent).toContain('Aguarde 5 minutos.');
    expect(visivel.value).toBe(true);
    erro = erroApi('recusa-de-negocio', 422, 'Não pode.');
    digitar('[data-testid="senha-x"]', 'sintetica');
    await flushPromises();
    enviar('[data-testid="form-x"]');
    await flushPromises();
    expect(visivel.value).toBe(false);
    expect(falha).toHaveBeenCalledWith(erro);
    w.unmount();
  });

  it('acessível (axe): rótulos e ajudas ligados aos campos', async () => {
    const { w } = abrir({
      titulo: 'Inativar',
      texto: 'Texto sintético.',
      alerta: 'Aviso sintético.',
      motivo: 'Motivo',
      senha: true,
      confirmar: 'Inativar',
      gravar: async () => undefined,
    });
    await flushPromises();
    const r = await axe.run(q('[data-testid="form-gravacao"]')!, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((v) => v.id)).toEqual([]);
    const senha = q<HTMLInputElement>('[data-testid="dialogo-senha"]')!;
    expect(document.querySelector(`label[for="${senha.id}"]`)?.textContent).toBe('Sua senha');
    w.unmount();
  });
});
