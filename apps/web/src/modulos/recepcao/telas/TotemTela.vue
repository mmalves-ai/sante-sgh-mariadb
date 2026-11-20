<script setup lang="ts">
// Totem de autoatendimento (M19; ficha, seção 7, regras 3, 9 e 11): tela cheia, botões grandes, sem sessão de
// pessoa (o token do aparelho). Toque no serviço → (se o serviço emite prioritária) a pergunta da prioridade legal
// → a senha com as senhas à frente, para imprimir. "Tenho consulta ou exame marcado": o CPF (teclado numérico),
// ou o código do agendamento (consulta ou exame) seguido do CPF, e o serviço → a senha já ligada ao agendamento. Sem conexão, a tela diz que a senha NÃO
// foi emitida (nunca imprime senha que não existe). Volta ao início sozinha depois de 20 s.
import type { SenhaEmitida, TotemConfig } from '@sgh/contratos';
import { useQuery } from '@tanstack/vue-query';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import {
  checkinNoTotem,
  codigoDaRecusa,
  emitirNoTotem,
  lerTotem,
  novaChave,
  tokenDoAparelho,
} from '../api-recepcao.js';
import { horaDe } from '../formato.js';

const props = defineProps<{ dispositivo: string }>();
const { t, te } = useI18n();
const token = tokenDoAparelho(props.dispositivo);
const config = useQuery({
  queryKey: ['totem', props.dispositivo],
  queryFn: () => lerTotem(token as string),
  enabled: token !== null,
  refetchInterval: 60_000,
  retry: 1,
});
type Passo = 'inicio' | 'prioridade' | 'checkin' | 'checkinServico' | 'senha' | 'falha';
const passo = ref<Passo>('inicio');
const servico = ref<TotemConfig['servicos'][number] | null>(null);
const emitida = ref<SenhaEmitida | null>(null);
const falha = ref('');
const ocupado = ref(false);
const digitos = ref('');
const modoCodigo = ref(false);
/** O código do agendamento: de consulta (C) ou de exame (E); o CPF é pedido em seguida, sempre. */
const tipoCodigo = ref<'C' | 'E'>('C');
const codigoEscolhido = ref<string | null>(null);
const cpfDigitado = ref('');
let volta: ReturnType<typeof setTimeout> | undefined;

function inicio(): void {
  clearTimeout(volta);
  passo.value = 'inicio';
  servico.value = null;
  emitida.value = null;
  digitos.value = '';
  modoCodigo.value = false;
  tipoCodigo.value = 'C';
  codigoEscolhido.value = null;
  cpfDigitado.value = '';
}
function voltarDepois(ms = 20_000): void {
  clearTimeout(volta);
  volta = setTimeout(inicio, ms);
}
onBeforeUnmount(() => clearTimeout(volta));

function textoDaFalha(e: unknown): string {
  const c = codigoDaRecusa(e);
  if (c === 'agendamento-nao-encontrado') return t('recepcao.totem.naoEncontrado');
  if (c === 'servico-fora-do-totem') return t('recepcao.totem.servicoIndisponivel');
  if (c === 'muitas-tentativas') return t('recepcao.totem.muitasTentativas');
  if (c && te(`recepcao.recusas.${c}`)) return t(`recepcao.recusas.${c}`);
  if (e instanceof ErroApi && (e.status === 401 || e.status === 403))
    return t('recepcao.totem.foraDeServico');
  return t('recepcao.totem.semConexao');
}
async function emitir(acao: () => Promise<SenhaEmitida>): Promise<void> {
  if (ocupado.value) return;
  ocupado.value = true;
  try {
    emitida.value = await acao();
    passo.value = 'senha';
    voltarDepois();
  } catch (e) {
    falha.value = textoDaFalha(e);
    passo.value = 'falha';
    voltarDepois(10_000);
  } finally {
    ocupado.value = false;
  }
}
function escolher(s: TotemConfig['servicos'][number]): void {
  servico.value = s;
  if (s.prioritaria && (config.data.value?.gruposPrioridade.length ?? 0) > 0) {
    passo.value = 'prioridade';
    voltarDepois();
  } else
    void emitir(() =>
      emitirNoTotem(token as string, { gerador: s.gerador, grupo: null }, novaChave('totem')),
    );
}
function comGrupo(grupo: number | null): void {
  const s = servico.value;
  if (!s) return;
  void emitir(() => emitirNoTotem(token as string, { gerador: s.gerador, grupo }, novaChave('totem')));
}
const tamanho = computed(() => (modoCodigo.value ? 10 : 11));
function digitar(d: string): void {
  if (digitos.value.length < tamanho.value) digitos.value += d;
  voltarDepois();
}
const apagar = () => (digitos.value = digitos.value.slice(0, -1));
const podeConfirmar = computed(() =>
  modoCodigo.value ? digitos.value.length >= 1 : digitos.value.length === 11,
);
/** Confirma o que foi digitado: o código (de consulta ou de exame) pede o CPF em seguida; o CPF vai ao serviço. */
function confirmarDigitos(): void {
  if (modoCodigo.value) {
    codigoEscolhido.value = `${tipoCodigo.value}${digitos.value}`;
    modoCodigo.value = false;
    digitos.value = '';
    voltarDepois();
    return;
  }
  cpfDigitado.value = digitos.value;
  passo.value = 'checkinServico';
  voltarDepois();
}
function checkin(s: TotemConfig['servicos'][number]): void {
  const dados = {
    cpf: cpfDigitado.value,
    ...(codigoEscolhido.value ? { codigo: codigoEscolhido.value } : {}),
  };
  void emitir(() => checkinNoTotem(token as string, { ...dados, gerador: s.gerador }, novaChave('checkin')));
}
// No check-in, só os serviços de recepção (a chegada se liga à senha que abre o atendimento).
const servicosNormais = computed(() =>
  (config.data.value?.servicos ?? []).filter((s) => !s.prioritaria && s.recepcao),
);
const imprimir = () => globalThis.print?.();
const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
</script>

<template>
  <main class="totem" data-testid="totem" aria-live="polite">
    <p v-if="!token" class="mensagem-grande" role="alert">{{ t('recepcao.totem.naoConfigurado') }}</p>
    <p v-else-if="config.isError.value" class="mensagem-grande" role="alert" data-testid="totem-fora">
      {{ textoDaFalha(config.error.value) }}
    </p>
    <p v-else-if="!config.data.value" role="status">{{ t('recepcao.carregando') }}</p>
    <template v-else>
      <header>
        <h1>{{ t('recepcao.totem.bemVindo') }}</h1>
        <p>{{ config.data.value.nome }}</p>
      </header>

      <section v-if="passo === 'inicio'" aria-labelledby="totem-escolha">
        <h2 id="totem-escolha">{{ t('recepcao.totem.escolha') }}</h2>
        <div class="botoes">
          <button
            v-for="s in config.data.value.servicos"
            :key="s.gerador"
            type="button"
            class="botao-grande"
            :disabled="ocupado"
            :data-testid="`totem-servico-${s.gerador}`"
            @click="escolher(s)"
          >
            {{ s.rotulo }}
          </button>
          <button
            v-if="config.data.value.checkin"
            type="button"
            class="botao-grande secundario"
            data-testid="totem-checkin"
            @click="((passo = 'checkin'), voltarDepois())"
          >
            {{ t('recepcao.totem.checkin') }}
          </button>
        </div>
      </section>

      <section v-else-if="passo === 'prioridade'" aria-labelledby="totem-prioridade">
        <h2 id="totem-prioridade">{{ t('recepcao.totem.prioridade') }}</h2>
        <div class="botoes">
          <button
            v-for="g in config.data.value.gruposPrioridade"
            :key="g.grupo"
            type="button"
            class="botao-grande"
            :disabled="ocupado"
            :data-testid="`totem-grupo-${g.grupo}`"
            @click="comGrupo(g.grupo)"
          >
            {{ g.rotulo }}
          </button>
          <button type="button" class="botao-grande secundario" @click="inicio">
            {{ t('recepcao.totem.voltar') }}
          </button>
        </div>
      </section>

      <section v-else-if="passo === 'checkin'" aria-labelledby="totem-checkin-titulo">
        <h2 id="totem-checkin-titulo">{{ t('recepcao.totem.checkin') }}</h2>
        <p v-if="codigoEscolhido" data-testid="totem-cpf-do-codigo">{{ t('recepcao.totem.cpfDoCodigo') }}</p>
        <p v-else>{{ t('recepcao.totem.checkinTexto') }}</p>
        <div v-if="!codigoEscolhido" class="botoes">
          <button
            type="button"
            class="botao-medio"
            :aria-pressed="!modoCodigo"
            @click="((modoCodigo = false), (digitos = ''))"
          >
            {{ t('recepcao.totem.cpf') }}
          </button>
          <button
            type="button"
            class="botao-medio"
            :aria-pressed="modoCodigo"
            @click="((modoCodigo = true), (digitos = ''))"
          >
            {{ t('recepcao.totem.codigo') }}
          </button>
        </div>
        <div
          v-if="modoCodigo"
          class="botoes"
          role="group"
          :aria-label="t('recepcao.totem.tipoCodigo')"
          data-testid="totem-tipo-codigo"
        >
          <button
            type="button"
            class="botao-medio"
            :aria-pressed="tipoCodigo === 'C'"
            data-testid="totem-codigo-consulta"
            @click="tipoCodigo = 'C'"
          >
            {{ t('recepcao.totem.consulta') }}
          </button>
          <button
            type="button"
            class="botao-medio"
            :aria-pressed="tipoCodigo === 'E'"
            data-testid="totem-codigo-exame"
            @click="tipoCodigo = 'E'"
          >
            {{ t('recepcao.totem.exame') }}
          </button>
        </div>
        <output
          class="digitos"
          data-testid="totem-digitos"
          :aria-label="modoCodigo ? t('recepcao.totem.codigo') : t('recepcao.totem.cpf')"
        >
          {{ digitos || '—' }}
        </output>
        <div class="teclado" role="group" :aria-label="t('recepcao.totem.teclado')">
          <button
            v-for="d in TECLAS"
            :key="d"
            type="button"
            class="tecla"
            :aria-label="t('recepcao.totem.digito', { d })"
            :data-testid="`tecla-${d}`"
            @click="digitar(d)"
          >
            {{ d }}
          </button>
          <button type="button" class="tecla" @click="apagar">{{ t('recepcao.totem.apagar') }}</button>
        </div>
        <div class="botoes">
          <button
            type="button"
            class="botao-medio"
            :disabled="!podeConfirmar"
            data-testid="totem-confirmar"
            @click="confirmarDigitos"
          >
            {{ t('recepcao.totem.confirmar') }}
          </button>
          <button type="button" class="botao-medio secundario" @click="inicio">
            {{ t('recepcao.totem.voltar') }}
          </button>
        </div>
      </section>

      <section v-else-if="passo === 'checkinServico'" aria-labelledby="totem-checkin-servico">
        <h2 id="totem-checkin-servico">{{ t('recepcao.totem.escolha') }}</h2>
        <div class="botoes">
          <button
            v-for="s in servicosNormais"
            :key="s.gerador"
            type="button"
            class="botao-grande"
            :disabled="ocupado"
            :data-testid="`totem-checkin-servico-${s.gerador}`"
            @click="checkin(s)"
          >
            {{ s.rotulo }}
          </button>
          <button type="button" class="botao-grande secundario" @click="inicio">
            {{ t('recepcao.totem.voltar') }}
          </button>
        </div>
      </section>

      <section
        v-else-if="passo === 'senha' && emitida"
        class="ticket"
        aria-labelledby="totem-sua-senha"
        data-testid="totem-ticket"
      >
        <h2 id="totem-sua-senha">{{ t('recepcao.totem.suaSenha') }}</h2>
        <p class="senha-enorme" data-testid="totem-senha">{{ emitida.texto }}</p>
        <p>{{ emitida.servico }} · {{ horaDe(emitida.emitidaEm) }}</p>
        <p>{{ t('recepcao.totem.aFrente', { n: emitida.aFrente }) }}</p>
        <p v-if="emitida.agendamento">
          {{ t('recepcao.totem.agendamento', { hora: emitida.agendamento.hora }) }}
        </p>
        <p>{{ t('recepcao.totem.aguarde') }}</p>
        <div class="botoes nao-imprimir">
          <button type="button" class="botao-medio" @click="imprimir">
            {{ t('recepcao.totem.imprimir') }}
          </button>
          <button type="button" class="botao-medio secundario" data-testid="totem-nova" @click="inicio">
            {{ t('recepcao.totem.novo') }}
          </button>
        </div>
      </section>

      <section v-else-if="passo === 'falha'" role="alert" data-testid="totem-falha">
        <p class="mensagem-grande">{{ falha }}</p>
        <button type="button" class="botao-medio" @click="inicio">{{ t('recepcao.totem.voltar') }}</button>
      </section>
    </template>
  </main>
</template>

<style scoped>
.totem {
  min-height: 100vh;
  padding: var(--sgh-espaco-4);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
  text-align: center;
  font-size: 1.5rem;
}
.botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  justify-content: center;
  margin: var(--sgh-espaco-3) 0;
}
button {
  font: inherit;
  cursor: pointer;
  border: 2px solid var(--sgh-borda-forte);
  background: var(--sgh-primaria);
  color: var(--sgh-primaria-texto);
  border-radius: 8px;
}
button.secundario {
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
button:focus-visible {
  outline: 4px solid var(--sgh-foco);
  outline-offset: 2px;
}
button:disabled {
  opacity: 0.6;
  cursor: default;
}
.botao-grande {
  min-width: 18rem;
  min-height: 7rem;
  font-size: 1.75rem;
  font-weight: 700;
  padding: var(--sgh-espaco-3);
}
.botao-medio {
  min-width: 12rem;
  min-height: 4rem;
  padding: var(--sgh-espaco-2);
}
button[aria-pressed='true'] {
  outline: 4px solid var(--sgh-foco);
}
.teclado {
  display: grid;
  grid-template-columns: repeat(3, 6rem);
  gap: var(--sgh-espaco-2);
  justify-content: center;
}
.tecla {
  min-height: 5rem;
  font-size: 2rem;
  background: var(--sgh-fundo-elevado);
  color: var(--sgh-texto);
}
.digitos {
  display: block;
  font-size: 2.5rem;
  letter-spacing: 0.2em;
  margin: var(--sgh-espaco-3) 0;
}
.senha-enorme {
  font-size: 6rem;
  font-weight: 700;
  margin: var(--sgh-espaco-2) 0;
}
.mensagem-grande {
  font-size: 2rem;
  font-weight: 700;
}
@media print {
  .nao-imprimir,
  header {
    display: none;
  }
  .totem {
    min-height: 0;
    font-size: 12pt;
  }
  .senha-enorme {
    font-size: 40pt;
  }
}
</style>
