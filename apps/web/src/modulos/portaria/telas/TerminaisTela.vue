<script setup lang="ts">
// Terminais e catracas (M50, etapa 5; item `Hotelaria e apoio > Portaria e visitantes > Terminais e catracas`;
// `hotelaria.terminal.ler` / `.editar`): os terminais da portaria (o tipo e o fabricante do domínio do estabelecimento,
// o local e o sentido), pela versão lida; os eventos recentes da catraca (liberado ou negado, com o motivo); a
// integração (chave `portaria.catraca`, autorização do dono em produção) e, fora de produção, o simulador; os tipos e
// fabricantes de terminal pelo CRUD genérico (só consulta: o banco os trata como dado de sistema).
import type { SentidoCatraca, SentidoTerminal, TerminalLido } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteOpcoes, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import GrupoDominiosTela from '../../config/telas/GrupoDominiosTela.vue';
import { gravarTerminal, lerTerminais, simularCatraca } from '../api-portaria.js';
import ErroPortaria from '../componentes/ErroPortaria.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const painel = useQuery({ queryKey: ['portaria', 'terminais'], queryFn: () => lerTerminais() });
const p = computed(() => painel.data.value);
const pode = computed(() => p.value?.gravacao.operacoes['terminal']?.pode === true);
const erro = ref<unknown>(null);
const mensagem = ref('');
const hora = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)} ${x.slice(11, 16)}`;
const recarregar = () => cliente.invalidateQueries({ queryKey: ['portaria', 'terminais'] });

const editando = ref<TerminalLido | null>(null);
const form = ref({
  nome: '',
  tipoTerminal: null as number | null,
  local: '',
  sentido: 'ambos' as SentidoTerminal,
  ativo: true,
});
function editar(x: TerminalLido | null): void {
  editando.value = x;
  form.value = x
    ? { nome: x.nome, tipoTerminal: x.tipoTerminal, local: x.local, sentido: x.sentido, ativo: x.ativo }
    : { nome: '', tipoTerminal: null, local: '', sentido: 'ambos', ativo: true };
}
const opcoesTipo = computed(() => [
  { valor: null, rotulo: '—' },
  ...(p.value?.dominios.tiposTerminal ?? [])
    .filter((x) => x.ativo)
    .map((x) => ({ valor: x.codigo as number | null, rotulo: `${x.nome} · ${x.fabricanteNome}` })),
]);
const opcoesSentido = computed(() =>
  (['entrada', 'saida', 'ambos'] as const).map((s) => ({
    valor: s,
    rotulo: t(`portaria.terminais.sentidos.${s}`),
  })),
);
async function gravar(): Promise<void> {
  erro.value = null;
  try {
    mensagem.value = (
      await gravarTerminal(editando.value?.id ?? null, {
        ...form.value,
        versao: editando.value?.versao ?? null,
      })
    ).mensagem;
    editar(null);
    await recarregar();
  } catch (x) {
    erro.value = x;
  }
}

const sim = ref({ terminal: null as number | null, cracha: '', sentido: 'entrada' as SentidoCatraca });
const opcoesTerminal = computed(() => [
  { valor: null, rotulo: '—' },
  ...(p.value?.terminais ?? []).map((x) => ({ valor: x.id as number | null, rotulo: x.nome })),
]);
const opcoesSentidoCatraca = computed(() =>
  (['entrada', 'saida'] as const).map((s) => ({ valor: s, rotulo: t(`portaria.terminais.sentidos.${s}`) })),
);
const resultado = ref<string | null>(null);
async function simular(): Promise<void> {
  erro.value = null;
  try {
    const r = await simularCatraca({
      terminal: sim.value.terminal,
      cracha: sim.value.cracha.trim().toUpperCase(),
      sentido: sim.value.sentido,
    });
    resultado.value =
      r.resultado === 'liberado'
        ? t('portaria.terminais.liberado')
        : t('portaria.terminais.negado', { motivo: r.motivo ?? '' });
    await recarregar();
  } catch (x) {
    erro.value = x;
  }
}
</script>

<template>
  <section class="tela-portaria" aria-labelledby="tm-titulo" data-testid="tela-terminais">
    <h1 id="tm-titulo">{{ t('portaria.terminais.titulo') }}</h1>
    <p>{{ t('portaria.terminais.subtitulo') }}</p>
    <p v-if="painel.isLoading.value">{{ t('portaria.carregando') }}</p>
    <ErroPortaria v-else-if="painel.error.value" :erro="painel.error.value" />
    <template v-else-if="p">
      <SanteAlerta
        :variante="p.catracaLigada ? 'info' : 'aviso'"
        :texto="
          p.catracaLigada ? t('portaria.terminais.catracaLigada') : t('portaria.terminais.catracaDesligada')
        "
        data-testid="tm-catraca"
      />
      <p v-if="mensagem" role="status" data-testid="tm-mensagem">{{ mensagem }}</p>
      <ErroPortaria v-if="erro" :erro="erro" />

      <section class="cartao" aria-labelledby="tm-lista">
        <h2 id="tm-lista">{{ t('portaria.terminais.lista') }}</h2>
        <p v-if="p.terminais.length === 0">{{ t('portaria.terminais.nenhum') }}</p>
        <div v-else class="rolagem">
          <table class="grade" data-testid="tm-terminais">
            <thead>
              <tr>
                <th scope="col">{{ t('portaria.terminais.nome') }}</th>
                <th scope="col">{{ t('portaria.terminais.tipo') }}</th>
                <th scope="col">{{ t('portaria.terminais.local') }}</th>
                <th scope="col">{{ t('portaria.terminais.sentido') }}</th>
                <th scope="col">{{ t('portaria.terminais.ativo') }}</th>
                <th scope="col">{{ t('portaria.acoes') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="x in p.terminais" :key="x.id">
                <td>{{ x.nome }}</td>
                <td>{{ x.tipoNome }} · {{ x.fabricanteNome }}</td>
                <td>{{ x.local }}</td>
                <td>{{ t(`portaria.terminais.sentidos.${x.sentido}`) }}</td>
                <td>{{ x.ativo ? t('portaria.sim') : t('portaria.nao') }}</td>
                <td>
                  <SanteBotao
                    variante="texto"
                    :rotulo="t('portaria.regras.editar')"
                    :desabilitado="!pode"
                    @acionar="editar(x)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <form class="registro" data-testid="tm-form" @submit.prevent="gravar">
          <h3>
            {{
              editando
                ? t('portaria.terminais.alterar', { nome: editando.nome })
                : t('portaria.terminais.novo')
            }}
          </h3>
          <div class="campos">
            <span class="campo">
              <label for="tm-nome">{{ t('portaria.terminais.nome') }}</label>
              <input id="tm-nome" v-model="form.nome" maxlength="40" data-testid="tm-nome" />
            </span>
            <SanteSelecao
              v-model="form.tipoTerminal"
              :rotulo="t('portaria.terminais.tipo')"
              :opcoes="opcoesTipo"
              data-testid="tm-tipo"
            />
            <span class="campo">
              <label for="tm-local">{{ t('portaria.terminais.local') }}</label>
              <input id="tm-local" v-model="form.local" maxlength="40" data-testid="tm-local" />
            </span>
            <label class="barra"
              ><input v-model="form.ativo" type="checkbox" /> {{ t('portaria.terminais.ativo') }}</label
            >
          </div>
          <SanteOpcoes
            v-model="form.sentido"
            :legenda="t('portaria.terminais.sentido')"
            :opcoes="opcoesSentido"
            nome="tm-sentido"
          />
          <div class="barra">
            <SanteBotao
              tipo="submit"
              :rotulo="t('portaria.terminais.gravar')"
              :desabilitado="
                !pode ||
                form.nome.trim().length < 2 ||
                form.tipoTerminal === null ||
                form.local.trim().length < 2
              "
              data-testid="tm-gravar"
            />
            <SanteBotao
              v-if="editando"
              variante="texto"
              :rotulo="t('portaria.cancelar')"
              @acionar="editar(null)"
            />
          </div>
        </form>
      </section>

      <section v-if="p.simulador" class="cartao" aria-labelledby="tm-simulador" data-testid="tm-simulador">
        <h2 id="tm-simulador">{{ t('portaria.terminais.simulador') }}</h2>
        <p class="secundario">{{ t('portaria.terminais.simuladorAjuda') }}</p>
        <form class="campos" @submit.prevent="simular">
          <SanteSelecao
            v-model="sim.terminal"
            :rotulo="t('portaria.terminais.terminal')"
            :opcoes="opcoesTerminal"
            data-testid="tm-sim-terminal"
          />
          <span class="campo">
            <label for="tm-sim-cracha">{{ t('portaria.abertas.cracha') }}</label>
            <input id="tm-sim-cracha" v-model="sim.cracha" maxlength="20" data-testid="tm-sim-cracha" />
          </span>
          <SanteSelecao
            v-model="sim.sentido"
            :rotulo="t('portaria.terminais.sentido')"
            :opcoes="opcoesSentidoCatraca"
            data-testid="tm-sim-sentido"
          />
          <SanteBotao
            tipo="submit"
            :rotulo="t('portaria.terminais.passar')"
            :desabilitado="!pode || !p.catracaLigada || sim.terminal === null || sim.cracha.trim().length < 6"
            data-testid="tm-sim-passar"
          />
        </form>
        <p v-if="resultado" role="status" data-testid="tm-sim-resultado">{{ resultado }}</p>
      </section>

      <section aria-labelledby="tm-eventos">
        <h2 id="tm-eventos">{{ t('portaria.terminais.eventos') }}</h2>
        <p v-if="p.eventos.length === 0">{{ t('portaria.terminais.semEventos') }}</p>
        <ul v-else class="lista" data-testid="tm-eventos">
          <li v-for="e in p.eventos" :key="e.id">
            {{ hora(e.ocorridoEm) }} · {{ e.terminalNome }} ·
            {{ t(`portaria.terminais.sentidos.${e.sentido}`) }} · {{ e.cracha }} ·
            <strong :class="e.resultado === 'liberado' ? 'ok' : 'alerta'">{{
              e.resultado === 'liberado'
                ? t('portaria.terminais.liberado')
                : t('portaria.terminais.negado', { motivo: e.motivo ?? '' })
            }}</strong>
          </li>
        </ul>
      </section>

      <GrupoDominiosTela subitem="portariaTerminais" embutida />
    </template>
  </section>
</template>

<style src="../estilo-portaria.css"></style>
