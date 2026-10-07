import { useEffect, useRef, useState } from 'react';
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { Field } from './Field';
import { Button } from './Button';
import { Pesquisa } from '../cadmaster/Pesquisa';
import { apiHeaders, handle401 } from '../auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

type Linha = Record<string, any>;

interface Props {
  /** a legenda do campo (com & do .dfm) */
  label: string;
  /** a Pesquisa do lookup (`lookup/parceiros`, `lookup/produtos`… em apps/api/src/shared/pesquisa/telas.ts) */
  recurso: string;
  /** a coluna da view que é o código gravado (o "retorno 1" do TfrmPesquisa.Create) */
  campoCodigo: string;
  /** a coluna (ou a função) que mostra a descrição ao lado (o "retorno 2") */
  descricao: string | ((linha: Linha) => string);
  /** o filtro obrigatório deste campo no legado (FRN='S', CLASSE='A'…) */
  fixos?: Record<string, string | number>;
  value?: string | number | null;
  /** o código escolhido (undefined = vazio) e a linha inteira da view (o RetornoUnicoPesquisa) */
  onChange: (codigo: string | undefined, linha?: Linha) => void;
  disabled?: boolean;
  error?: string;
}

async function buscarPorCodigo(recurso: string, campo: string, codigo: string, fixos?: Record<string, string | number>): Promise<Linha | null> {
  const qs = new URLSearchParams({ recurso, campo, operacao: 'igual', valor: codigo, situacao: 'todos', porPagina: '1' });
  for (const [k, v] of Object.entries(fixos ?? {})) qs.set(`f_${k}`, String(v));
  const r = await fetch(`${BASE}/cadastro/pesquisa?${qs.toString()}`, { headers: apiHeaders() });
  handle401(r);
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    const env: ErroResposta = isErroResposta(b) ? b : { statusCode: r.status, code: 'ERRO', message: r.statusText };
    throw Object.assign(new Error(env.code), { envelope: env });
  }
  const j = (await r.json()) as { linhas: Linha[] };
  return j.linhas[0] ?? null;
}

/**
 * O CAMPO DE LOOKUP do legado: o código (TEdit) + a descrição ao lado + o botão que abre a Pesquisa da view (`TfrmPesquisa.Create(Self,
 * 'GET_X', edtCod, 'CAMPO_COD', edtDesc, 'CAMPO_DESC', '<filtro obrigatório>')`). Substitui o combo carregado com a tabela inteira (que o
 * Apollo cortava em 200: a maior parte dos parceiros, produtos, cidades e contas contábeis não aparecia). Digitar o código e sair
 * (Enter/Tab) confere no servidor e mostra a descrição; código que não existe (no filtro do campo) fica marcado.
 */
export function LookupField({ label, recurso, campoCodigo, descricao, fixos, value, onChange, disabled, error }: Props) {
  const [texto, setTexto] = useState(value == null ? '' : String(value));
  const [desc, setDesc] = useState('');
  const [naoAchou, setNaoAchou] = useState(false);
  const [pesquisando, setPesquisando] = useState(false);
  const ultimo = useRef<string>('');
  const fixosChave = JSON.stringify(fixos ?? {});

  const descreve = (l: Linha) => (typeof descricao === 'function' ? descricao(l) : String(l[descricao] ?? ''));

  // o valor que vem de fora (o registro carregado): mostra a descrição dele
  useEffect(() => {
    const v = value == null ? '' : String(value);
    setTexto(v);
    if (v === ultimo.current) return;
    ultimo.current = v;
    setNaoAchou(false);
    if (!v) { setDesc(''); return; }
    let vivo = true;
    buscarPorCodigo(recurso, campoCodigo, v, fixos).then((l) => { if (vivo) { setDesc(l ? descreve(l) : ''); setNaoAchou(!l); } }).catch(() => undefined);
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, recurso, campoCodigo, fixosChave]);

  const conferir = async () => {
    const v = texto.trim();
    if (v === ultimo.current) return;
    ultimo.current = v;
    if (!v) { setDesc(''); setNaoAchou(false); onChange(undefined); return; }
    const l = await buscarPorCodigo(recurso, campoCodigo, v, fixos).catch(() => null);
    setDesc(l ? descreve(l) : '');
    setNaoAchou(!l);
    onChange(l ? String(l[campoCodigo]) : undefined, l ?? undefined);
  };

  return (
    <div className="flex items-end gap-gp-xs">
      <div className="w-32">
        <Field
          label={label}
          value={texto}
          disabled={disabled}
          error={error ?? (naoAchou ? 'Não encontrado' : undefined)}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={() => void conferir()}
          onKeyDown={(e) => { if (e.key === 'Enter') void conferir(); }}
        />
      </div>
      <Button label="…" variant="soft" disabled={disabled} onClick={() => setPesquisando(true)} />
      <span className="min-w-0 flex-1 truncate pb-2 text-body-sm text-fg-muted" title={desc}>{desc}</span>
      {pesquisando && (
        <Pesquisa
          resourcePath={recurso}
          fixos={fixos}
          onFechar={() => setPesquisando(false)}
          onSelecionar={(l) => {
            setPesquisando(false);
            const v = String(l[campoCodigo] ?? '');
            ultimo.current = v;
            setTexto(v);
            setDesc(descreve(l));
            setNaoAchou(false);
            onChange(v || undefined, l);
          }}
        />
      )}
    </div>
  );
}
