<script setup lang="ts">
// Medicamentos controlados (ficha do M29, seção 7; regra 4; cap-13 CTRL-01 a CTRL-03): `/farmacia/controlados`. O
// saldo por substância no período (dos dois sistemas), os movimentos com o documento e o prescritor, a segunda
// conferência por outro farmacêutico (com a senha) e a perda ou o descarte com testemunha.
import type { MovimentoControladoLido, SaldoControlado } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { conferir, lerControlados, lerMovimentos, novaChave, registrarPerda } from '../api-farmacia.js';
import AvisoFarmacia from '../componentes/AvisoFarmacia.vue';
import ErroFarmacia from '../componentes/ErroFarmacia.vue';
import { data, numero, qtd, usarFarmacia } from '../usar-farmacia.js';

const { t } = useI18n();
const { pode, motivo, motivoFuncionalidade } = usarFarmacia();
const inicio = ref('');
const fim = ref('');
const lista = useQuery({
  queryKey: computed(() => ['farmacia', 'controlados', inicio.value, fim.value]),
  queryFn: () => lerControlados({ inicio: inicio.value || undefined, fim: fim.value || undefined }),
});
const aberto = ref<SaldoControlado | null>(null);
const movimentos = ref<(MovimentoControladoLido & { documentoId: number })[]>([]);
const contadas = ref<Record<number, string>>({});
const senha = ref('');
const justificativa = ref('');
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const perda = ref({
  lote: '',
  validade: '',
  quantidade: '',
  motivo: '',
  testemunha: '',
  centro: '300100',
  local: '10',
});
async function abrir(s: SaldoControlado): Promise<void> {
  aberto.value = s;
  erro.value = null;
  try {
    const r = await lerMovimentos(s.item, { inicio: lista.data.value?.inicio, fim: lista.data.value?.fim });
    movimentos.value = r.movimentos;
  } catch (x) {
    erro.value = x;
  }
}
async function conferirMov(m: MovimentoControladoLido & { documentoId: number }): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  try {
    const r = await conferir(
      {
        senha: senha.value,
        dados: {
          item: m.item,
          documento: {
            tipo: m.tipo === 'devolucao' ? 'devolucao' : m.tipo === 'perda' ? 'perda' : 'saida',
            id: m.documentoId,
          },
          quantidadeDocumento: m.quantidade,
          quantidadeContada: numero(contadas.value[m.documentoId] ?? String(m.quantidade)),
          justificativa: justificativa.value,
        },
      },
      novaChave('conferir'),
    );
    mensagem.value = r.mensagem;
    if (aberto.value) await abrir(aberto.value);
  } catch (x) {
    erro.value = x;
  }
}
async function registrar(): Promise<void> {
  if (!aberto.value) return;
  erro.value = null;
  try {
    const p = perda.value;
    const r = await registrarPerda(
      {
        senha: senha.value,
        dados: {
          item: aberto.value.item,
          local: Number(p.local),
          centroCusto: Number(p.centro),
          lote: p.lote,
          validade: p.validade,
          quantidade: numero(p.quantidade),
          motivo: p.motivo,
          testemunha: p.testemunha,
        },
      },
      novaChave('perda'),
    );
    mensagem.value = r.mensagem;
    await lista.refetch();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="ctrl-titulo" data-testid="tela-farmacia-controlados">
    <h1 id="ctrl-titulo">{{ t('farmacia.controlados.titulo') }}</h1>
    <p>{{ t('farmacia.controlados.texto') }}</p>
    <p class="atalhos">
      <RouterLink to="/farmacia/livro">{{ t('farmacia.controlados.abrirLivro') }}</RouterLink>
      ·
      <RouterLink to="/farmacia/ambulatorial">{{ t('farmacia.ambulatorial.titulo') }}</RouterLink>
    </p>
    <AvisoFarmacia :motivo="motivoFuncionalidade('controlados')" />
    <div class="filtros">
      <span class="campo">
        <label for="ctrl-ini">{{ t('farmacia.inicio') }}</label>
        <input id="ctrl-ini" v-model="inicio" type="date" />
      </span>
      <span class="campo">
        <label for="ctrl-fim">{{ t('farmacia.fim') }}</label>
        <input id="ctrl-fim" v-model="fim" type="date" />
      </span>
    </div>
    <ErroFarmacia v-if="erro" :erro="erro" />
    <p v-if="mensagem" role="status" data-testid="ctrl-mensagem">{{ mensagem }}</p>
    <p v-if="lista.isLoading.value">{{ t('farmacia.carregando') }}</p>
    <table v-else class="tabela" data-testid="ctrl-saldos">
      <caption>
        {{
          data(lista.data.value?.inicio)
        }}
        —
        {{
          data(lista.data.value?.fim)
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('farmacia.item') }}</th>
          <th scope="col">{{ t('farmacia.controlados.lista') }}</th>
          <th scope="col">{{ t('farmacia.controlados.anterior') }}</th>
          <th scope="col">{{ t('farmacia.controlados.entradas') }}</th>
          <th scope="col">{{ t('farmacia.controlados.saidas') }}</th>
          <th scope="col">{{ t('farmacia.controlados.final') }}</th>
          <th scope="col">{{ t('farmacia.controlados.conferencias') }}</th>
          <th scope="col">{{ t('farmacia.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in lista.data.value?.itens ?? []" :key="s.item" :data-testid="`ctrl-item-${s.item}`">
          <td>{{ s.nome }}</td>
          <td>{{ s.lista }}</td>
          <td>{{ qtd(s.anterior) }}</td>
          <td>{{ qtd(s.entradas) }}</td>
          <td>{{ qtd(s.saidas) }}</td>
          <td>{{ qtd(s.final) }}</td>
          <td>{{ s.conferencias }}</td>
          <td>
            <SanteBotao
              variante="secundario"
              :rotulo="t('farmacia.controlados.movimentos')"
              :data-testid="`ctrl-abrir-${s.item}`"
              @acionar="abrir(s)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <section v-if="aberto" class="painel" aria-labelledby="ctrl-mov">
      <h2 id="ctrl-mov">{{ t('farmacia.controlados.movimentos') }}: {{ aberto.nome }}</h2>
      <span class="campo">
        <label for="ctrl-senha">{{ t('farmacia.senha') }}</label>
        <input
          id="ctrl-senha"
          v-model="senha"
          type="password"
          autocomplete="current-password"
          data-testid="ctrl-senha"
        />
      </span>
      <span class="campo">
        <label for="ctrl-just">{{ t('farmacia.justificativa') }}</label>
        <input id="ctrl-just" v-model="justificativa" maxlength="250" />
      </span>
      <table class="tabela" data-testid="ctrl-movimentos">
        <caption class="sgh-visualmente-oculto">
          {{
            t('farmacia.controlados.movimentos')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('farmacia.controlados.documento') }}</th>
            <th scope="col">{{ t('farmacia.situacao') }}</th>
            <th scope="col">{{ t('farmacia.quantidade') }}</th>
            <th scope="col">{{ t('farmacia.controlados.prescritor') }}</th>
            <th scope="col">{{ t('farmacia.controlados.contada') }}</th>
            <th scope="col">{{ t('farmacia.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in movimentos" :key="`${m.documento}-${m.tipo}`">
            <td>{{ data(m.data) }} · {{ m.documento }}</td>
            <td>{{ t(`farmacia.controlados.tipos.${m.tipo}`) }}</td>
            <td>{{ qtd(m.quantidade) }}</td>
            <td>{{ m.prescritor ?? '—' }}</td>
            <td>
              <label :for="`ctrl-c-${m.documentoId}`" class="sgh-visualmente-oculto">{{
                t('farmacia.controlados.contada')
              }}</label>
              <input :id="`ctrl-c-${m.documentoId}`" v-model="contadas[m.documentoId]" inputmode="decimal" />
            </td>
            <td>
              <span v-if="m.conferido">{{ t('farmacia.controlados.conferido') }}</span>
              <SanteBotao
                v-else
                :rotulo="t('farmacia.controlados.conferir')"
                :desabilitado="!pode('conferir')"
                :data-testid="`ctrl-conferir-${m.documentoId}`"
                @acionar="conferirMov(m)"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <h3>{{ t('farmacia.controlados.perda') }}</h3>
      <AvisoFarmacia
        :motivo="
          pode('suprimentos.registrarPerdaControlado') ? null : motivo('suprimentos.registrarPerdaControlado')
        "
      />
      <form class="filtros" @submit.prevent="registrar">
        <span class="campo"
          ><label for="pd-lote">{{ t('farmacia.lote') }}</label
          ><input id="pd-lote" v-model="perda.lote"
        /></span>
        <span class="campo"
          ><label for="pd-val">{{ t('farmacia.validade') }}</label
          ><input id="pd-val" v-model="perda.validade" type="date"
        /></span>
        <span class="campo"
          ><label for="pd-q">{{ t('farmacia.quantidade') }}</label
          ><input id="pd-q" v-model="perda.quantidade" inputmode="decimal"
        /></span>
        <span class="campo"
          ><label for="pd-m">{{ t('farmacia.motivo') }}</label
          ><input id="pd-m" v-model="perda.motivo" maxlength="250"
        /></span>
        <span class="campo"
          ><label for="pd-t">{{ t('farmacia.controlados.testemunha') }}</label
          ><input id="pd-t" v-model="perda.testemunha" maxlength="31"
        /></span>
        <SanteBotao
          tipo="submit"
          variante="destrutivo"
          :confirmacao="t('farmacia.controlados.perda')"
          :rotulo="t('farmacia.controlados.perda')"
          :desabilitado="!pode('suprimentos.registrarPerdaControlado')"
        />
      </form>
    </section>
  </section>
</template>
