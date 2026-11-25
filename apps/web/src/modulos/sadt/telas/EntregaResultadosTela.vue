<script setup lang="ts">
// Entrega de resultados no balcão (F3.5, 05-SADT linha 21): `/sadt/entregas`. Visão por paciente: o balcão digita o
// número do pedido de exames ou do atendimento e vê, de uma vez, o que está pronto (já marcado para sair), o que ainda
// falta, com a previsão do prazo cadastrado, e os protocolos já emitidos. A entrega é um clique quando é o próprio
// paciente; quando é outra pessoa, o nome e o documento são conferidos na hora (o CPF pelos dígitos). O protocolo
// sai numerado e pode ser impresso; cancelar pede o motivo e nunca apaga.
import { cpfValido } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type BalcaoEntrega,
  cancelarEntrega,
  lerBalcao,
  type ProtocoloEntrega,
  registrarEntrega,
} from '../api-entrega.js';
import { novaChave } from '../api-sadt.js';
import ErroSadt from '../componentes/ErroSadt.vue';

const { t } = useI18n();
const busca = ref('');
const buscado = ref('');
const balcao = ref<BalcaoEntrega | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const carregando = ref(false);

const marcados = ref<number[]>([]);
const proprio = ref(true);
const responsavel = ref({ nome: '', cpf: '', documento: '', parentesco: '', telefone: '' });
const forma = ref('');
const observacao = ref('');
const cancelando = ref<number | null>(null);
const motivo = ref('');
const paraImprimir = ref<ProtocoloEntrega | null>(null);

const quando = (v: string | null) =>
  v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}${v.length > 10 ? ` ${v.slice(11, 16)}` : ''}` : '';
const opcoes = (xs: readonly { id: number; nome: string }[] | undefined) => [
  { valor: '', rotulo: t('sadt.entrega.naoInformado') },
  ...(xs ?? []).map((x) => ({ valor: String(x.id), rotulo: x.nome })),
];
const formas = computed(() => opcoes(balcao.value?.formas));
const parentescos = computed(() => opcoes(balcao.value?.parentescos));

const cpfDigitos = computed(() => responsavel.value.cpf.replace(/\D/g, ''));
const cpfRuim = computed(() => cpfDigitos.value !== '' && !cpfValido(cpfDigitos.value));
const responsavelValido = computed(
  () =>
    proprio.value ||
    (responsavel.value.nome.trim().length >= 3 &&
      !cpfRuim.value &&
      (cpfDigitos.value !== '' || responsavel.value.documento.trim() !== '')),
);
const podeRegistrar = computed(
  () => marcados.value.length > 0 && responsavelValido.value && !carregando.value,
);

async function carregar(numero: string): Promise<void> {
  carregando.value = true;
  erro.value = null;
  try {
    const b = await lerBalcao(numero);
    balcao.value = b;
    buscado.value = numero;
    // Tudo o que está pronto já vem marcado: a entrega do próprio paciente é um clique.
    marcados.value = b.prontos.map((x) => x.item);
  } catch (x) {
    erro.value = x;
  } finally {
    carregando.value = false;
  }
}
function buscar(): void {
  mensagem.value = null;
  paraImprimir.value = null;
  if (busca.value.trim() !== '') void carregar(busca.value.trim());
}
function marcar(item: number, ligado: boolean): void {
  marcados.value = ligado
    ? [...new Set([...marcados.value, item])]
    : marcados.value.filter((i) => i !== item);
}

async function registrar(): Promise<void> {
  if (!balcao.value?.paciente || !podeRegistrar.value) return;
  erro.value = null;
  mensagem.value = null;
  carregando.value = true;
  try {
    const r = await registrarEntrega(
      {
        paciente: balcao.value.paciente.id,
        itens: marcados.value,
        forma: forma.value ? Number(forma.value) : null,
        retiradoPeloPaciente: proprio.value,
        nomeResponsavel: proprio.value ? null : responsavel.value.nome.trim(),
        cpfResponsavel: proprio.value || cpfDigitos.value === '' ? null : cpfDigitos.value,
        documentoResponsavel: proprio.value ? null : responsavel.value.documento.trim() || null,
        parentesco:
          proprio.value || !responsavel.value.parentesco ? null : Number(responsavel.value.parentesco),
        telefoneResponsavel: proprio.value ? null : responsavel.value.telefone.trim() || null,
        observacao: observacao.value.trim() || null,
      },
      novaChave('entrega.registrar'),
    );
    await carregar(buscado.value);
    mensagem.value = t('sadt.entrega.registrada', { numero: r.numero });
    paraImprimir.value = balcao.value?.entregas.find((e) => e.id === r.id) ?? null;
    proprio.value = true;
    responsavel.value = { nome: '', cpf: '', documento: '', parentesco: '', telefone: '' };
    observacao.value = '';
  } catch (x) {
    erro.value = x;
  } finally {
    carregando.value = false;
  }
}

async function confirmarCancelamento(id: number): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    await cancelarEntrega(id, motivo.value.trim(), novaChave('entrega.cancelar'));
    cancelando.value = null;
    motivo.value = '';
    paraImprimir.value = null;
    await carregar(buscado.value);
    mensagem.value = t('sadt.entrega.canceladaAgora');
  } catch (x) {
    erro.value = x;
  }
}

function imprimir(p: ProtocoloEntrega): void {
  paraImprimir.value = p;
  // A folha de impressão mostra só o protocolo (o resto da tela some na impressão).
  setTimeout(() => window.print(), 0);
}
</script>

<template>
  <section class="entrega" data-testid="entrega-resultados">
    <div class="tela">
      <h1>{{ t('sadt.entrega.titulo') }}</h1>
      <p>{{ t('sadt.entrega.explicacao') }}</p>
      <form class="linha" @submit.prevent="buscar">
        <label
          >{{ t('sadt.entrega.busca')
          }}<input v-model="busca" maxlength="30" autofocus data-testid="entrega-busca"
        /></label>
        <SanteBotao
          :rotulo="t('sadt.entrega.buscar')"
          :desabilitado="busca.trim() === '' || carregando"
          data-testid="entrega-buscar"
          @acionar="buscar"
        />
      </form>
      <p v-if="mensagem" role="status" data-testid="entrega-mensagem">{{ mensagem }}</p>
      <ErroSadt v-if="erro" :erro="erro" />
      <p v-if="balcao && !balcao.paciente" role="status" data-testid="entrega-nao-achado">
        {{ t('sadt.entrega.naoAchado') }}
      </p>

      <template v-if="balcao?.paciente">
        <h2 data-testid="entrega-paciente">
          {{ balcao.paciente.nome }} ·
          {{
            balcao.paciente.nascimento
              ? t('sadt.entrega.nascimento', { data: quando(balcao.paciente.nascimento) })
              : t('sadt.entrega.semNascimento')
          }}
        </h2>

        <fieldset data-testid="entrega-prontos">
          <legend>{{ t('sadt.entrega.prontos') }}</legend>
          <p v-if="balcao.prontos.length === 0">{{ t('sadt.entrega.nenhumPronto') }}</p>
          <ul>
            <li v-for="x in balcao.prontos" :key="x.item">
              <label
                ><input
                  type="checkbox"
                  :checked="marcados.includes(x.item)"
                  :data-testid="`entrega-item-${x.item}`"
                  @change="marcar(x.item, ($event.target as HTMLInputElement).checked)"
                />
                {{ x.exame }} · {{ t('sadt.entrega.pedido', { numero: x.pedido }) }}
                <template v-if="x.setor"> · {{ x.setor }}</template> ·
                {{ t(`sadt.entrega.situacoesPrazo.${x.situacaoPrazo}`) }}</label
              >
            </li>
          </ul>
          <template v-if="balcao.prontos.length > 0">
            <h3>{{ t('sadt.entrega.quemRetira') }}</h3>
            <div class="linha">
              <label
                ><input v-model="proprio" type="checkbox" data-testid="entrega-proprio" />
                {{ t('sadt.entrega.proprioPaciente') }}</label
              >
              <template v-if="!proprio">
                <label
                  >{{ t('sadt.entrega.nomeResponsavel')
                  }}<input v-model="responsavel.nome" maxlength="150" data-testid="entrega-nome"
                /></label>
                <label
                  >{{ t('sadt.entrega.cpfResponsavel')
                  }}<input
                    v-model="responsavel.cpf"
                    inputmode="numeric"
                    maxlength="14"
                    :aria-invalid="cpfRuim"
                    data-testid="entrega-cpf"
                /></label>
                <label
                  >{{ t('sadt.entrega.documentoResponsavel')
                  }}<input v-model="responsavel.documento" maxlength="30" data-testid="entrega-documento"
                /></label>
                <SanteSelecao
                  v-model="responsavel.parentesco"
                  :rotulo="t('sadt.entrega.parentesco')"
                  :opcoes="parentescos"
                  data-testid="entrega-parentesco"
                />
                <label
                  >{{ t('sadt.entrega.telefoneResponsavel')
                  }}<input v-model="responsavel.telefone" inputmode="tel" maxlength="20"
                /></label>
              </template>
              <SanteSelecao
                v-model="forma"
                :rotulo="t('sadt.entrega.forma')"
                :opcoes="formas"
                data-testid="entrega-forma"
              />
              <label>{{ t('sadt.entrega.observacao') }}<input v-model="observacao" maxlength="500" /></label>
            </div>
            <p v-if="cpfRuim" role="alert" data-testid="entrega-cpf-invalido">
              {{ t('sadt.entrega.cpfInvalido') }}
            </p>
            <p v-else-if="!responsavelValido" role="status" data-testid="entrega-falta-responsavel">
              {{ t('sadt.entrega.faltaResponsavel') }}
            </p>
            <SanteBotao
              :rotulo="t('sadt.entrega.registrar')"
              :desabilitado="!podeRegistrar"
              data-testid="entrega-registrar"
              @acionar="registrar"
            />
          </template>
        </fieldset>

        <fieldset data-testid="entrega-aguardando">
          <legend>{{ t('sadt.entrega.aguardando') }}</legend>
          <p v-if="balcao.aguardando.length === 0">{{ t('sadt.entrega.nenhumAguardando') }}</p>
          <ul>
            <li v-for="x in balcao.aguardando" :key="x.item">
              {{ x.exame }} · {{ t('sadt.entrega.pedido', { numero: x.pedido }) }} ·
              {{
                x.previsto
                  ? t('sadt.entrega.previsto', { quando: quando(x.previsto) })
                  : t('sadt.entrega.semPrevisao')
              }}
              <template v-if="x.previsto">
                ·
                <span :data-testid="`entrega-prazo-${x.item}`">{{
                  t(`sadt.entrega.situacoesPrazo.${x.situacaoPrazo}`)
                }}</span></template
              >
            </li>
          </ul>
        </fieldset>

        <fieldset data-testid="entrega-protocolos">
          <legend>{{ t('sadt.entrega.protocolos') }}</legend>
          <p v-if="balcao.entregas.length === 0">{{ t('sadt.entrega.nenhumProtocolo') }}</p>
          <ul>
            <li v-for="p in balcao.entregas" :key="p.id" :class="{ inativa: p.situacao === 'cancelada' }">
              <strong>{{ t('sadt.entrega.protocolo', { numero: p.numero }) }}</strong> ·
              {{ t('sadt.entrega.entregueEm', { quando: quando(p.entregueEm) }) }}
              <template v-if="p.entreguePor">
                {{ t('sadt.entrega.entreguePor', { quem: p.entreguePor }) }}</template
              >
              · {{ p.exames.map((e) => e.exame).join(', ') }} ·
              {{
                p.retiradoPeloPaciente
                  ? t('sadt.entrega.retiradoPeloPaciente')
                  : t('sadt.entrega.retiradoPor', {
                      nome: p.nomeResponsavel ?? '',
                      documento: p.documentoResponsavel ?? '',
                    })
              }}
              <span v-if="p.situacao === 'cancelada'" :data-testid="`entrega-cancelada-${p.id}`">
                · {{ t('sadt.entrega.cancelada', { motivo: p.motivoCancelamento ?? '' }) }}</span
              >
              <template v-else>
                <SanteBotao
                  :rotulo="t('sadt.entrega.imprimir')"
                  :data-testid="`entrega-imprimir-${p.id}`"
                  @acionar="imprimir(p)"
                />
                <SanteBotao
                  v-if="cancelando !== p.id"
                  :rotulo="t('sadt.entrega.cancelar')"
                  :data-testid="`entrega-cancelar-${p.id}`"
                  @acionar="
                    cancelando = p.id;
                    motivo = '';
                  "
                />
                <span v-else class="linha">
                  <label
                    >{{ t('sadt.entrega.motivoCancelamento')
                    }}<input v-model="motivo" maxlength="500" data-testid="entrega-motivo"
                  /></label>
                  <SanteBotao
                    :rotulo="t('sadt.entrega.confirmarCancelamento')"
                    :desabilitado="motivo.trim().length < 5"
                    data-testid="entrega-confirmar-cancelamento"
                    @acionar="confirmarCancelamento(p.id)"
                  />
                </span>
              </template>
            </li>
          </ul>
        </fieldset>
      </template>
    </div>

    <article v-if="paraImprimir && balcao?.paciente" class="folha" data-testid="entrega-folha">
      <h2>{{ t('sadt.entrega.protocolo', { numero: paraImprimir.numero }) }}</h2>
      <p>{{ balcao.paciente.nome }}</p>
      <p>{{ t('sadt.entrega.entregueEm', { quando: quando(paraImprimir.entregueEm) }) }}</p>
      <ul>
        <li v-for="e in paraImprimir.exames" :key="e.item">
          {{ e.exame }} · {{ t('sadt.entrega.pedido', { numero: e.pedido }) }}
        </li>
      </ul>
      <p>
        {{
          paraImprimir.retiradoPeloPaciente
            ? t('sadt.entrega.retiradoPeloPaciente')
            : t('sadt.entrega.retiradoPor', {
                nome: paraImprimir.nomeResponsavel ?? '',
                documento: paraImprimir.documentoResponsavel ?? '',
              })
        }}
      </p>
      <p class="assinatura">{{ t('sadt.entrega.assinatura') }}</p>
    </article>
  </section>
</template>

<style scoped>
.entrega,
.tela {
  display: grid;
  gap: 0.75rem;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}
label {
  display: grid;
  gap: 0.25rem;
}
li label {
  display: block;
}
.inativa {
  opacity: 0.6;
}
.folha {
  border-top: 1px dashed currentColor;
  padding-top: 0.75rem;
}
.assinatura {
  margin-top: 3rem;
  border-top: 1px solid currentColor;
  max-width: 24rem;
}
@media print {
  .tela {
    display: none;
  }
  .folha {
    border-top: 0;
  }
}
</style>
