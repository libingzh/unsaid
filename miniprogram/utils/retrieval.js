// 检索式匹配工具(与网页版一致)
function clean(s){ return (s||'').replace(/[\s,。,.!！?？、~…"''：:;；()（）]/g,''); }
function grams(s,n){ s=clean(s); var g={}; if(s.length<n){ if(s)g[s]=1; return g; } for(var i=0;i<=s.length-n;i++)g[s.substr(i,n)]=1; return g; }
function jac(ga,gb){ var ka=Object.keys(ga),kb=Object.keys(gb); if(!ka.length||!kb.length)return 0; var n=0; ka.forEach(function(k){ if(gb[k])n++; }); return n/(ka.length+kb.length-n); }
function sim(a,b){ return 0.65*jac(grams(a,2),grams(b,2)) + 0.35*jac(grams(a,1),grams(b,1)); }

// 从消息序列构建"我说的话 -> TA回复"配对
function buildPairs(messages){
  var pairs=[], taLines=[];
  for(var i=0;i<messages.length;i++){
    if(messages[i].who==='ta'){
      taLines.push(messages[i].text);
      var q=(i>0 && messages[i-1].who==='me')?messages[i-1].text:'';
      pairs.push({q:q,a:messages[i].text});
    }
  }
  return { pairs: pairs, taLines: taLines };
}
function retrieve(input, pairs, taLines){
  var best=null, bs=0;
  pairs.forEach(function(p){ if(!p.q)return; var s=sim(input,p.q); if(s>bs){ bs=s; best=p; } });
  if(!best){ taLines.forEach(function(t){ var s=sim(input,t); if(s>bs){ bs=s; best={q:'',a:t}; } }); }
  return { pair: best, score: bs };
}

module.exports = { sim: sim, buildPairs: buildPairs, retrieve: retrieve };
